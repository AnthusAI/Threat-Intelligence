use anyhow::{Context, Result, anyhow};
use aws_config::BehaviorVersion;
use aws_sdk_dynamodb::Client as DynamoClient;
use aws_sdk_dynamodb::types::AttributeValue;
use aws_sdk_ssm::Client as SsmClient;
use chrono::{Duration, Utc};
use lambda_runtime::{Error, LambdaEvent, run, service_fn};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::{error, info, warn};
use uuid::Uuid;

const DEFAULT_RESPONSE_TARGET: &str = "cloud";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const MESSAGE_KIND_CHAT_TURN: &str = "console_chat_turn";
const MESSAGE_KIND_TOOL_CALL: &str = "console_tool_call";
const MESSAGE_KIND_TOOL_RESULT: &str = "console_tool_result";
const MESSAGE_DOMAIN_CONVERSATION: &str = "conversation";
const NEWSROOM_FEED_CONSOLE_CHAT: &str = "consoleChat";
const CHAT_DETAIL_LAYER: &str = "chat_detail";
const EXPLICIT_SEARCH: &str = "explicit";
const CONTEXT_CACHE_SCHEMA_VERSION: u32 = 1;

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt().without_time().init();
    let aws_config = aws_config::defaults(BehaviorVersion::latest()).load().await;
    let dynamo = DynamoClient::new(&aws_config);
    let ssm = SsmClient::new(&aws_config);
    let config = AppConfig::from_env();
    let openai_api_key = load_openai_api_key(&ssm, &config).await?;
    let state = Arc::new(AppState {
        config,
        dynamo,
        http: reqwest::Client::new(),
        openai_api_key,
    });
    run(service_fn(move |event| {
        let state = Arc::clone(&state);
        async move { handler(event, state).await }
    }))
    .await
}

#[derive(Clone, Debug)]
struct AppConfig {
    message_table: String,
    thread_table: String,
    thread_sequence_index: String,
    response_target: String,
    model: String,
    openai_api_key_ssm_param: Option<String>,
    cache_root: PathBuf,
}

impl AppConfig {
    fn from_env() -> Self {
        Self {
            message_table: required_env("PAPYRUS_MESSAGE_TABLE_NAME"),
            thread_table: required_env("PAPYRUS_MESSAGE_THREAD_TABLE_NAME"),
            thread_sequence_index: env_or(
                "PAPYRUS_MESSAGE_THREAD_SEQUENCE_INDEX_NAME",
                "messagesByThreadSequence",
            ),
            response_target: env_or("PAPYRUS_CONSOLE_RESPONSE_TARGET", DEFAULT_RESPONSE_TARGET),
            model: env_or("PAPYRUS_CONSOLE_MODEL", DEFAULT_MODEL),
            openai_api_key_ssm_param: optional_env("PAPYRUS_CONSOLE_OPENAI_API_KEY_SSM_PARAM"),
            cache_root: PathBuf::from(env_or(
                "PAPYRUS_CONSOLE_CONTEXT_CACHE_ROOT",
                "/tmp/papyrus-console/thread-context",
            )),
        }
    }
}

#[derive(Clone)]
struct AppState {
    config: AppConfig,
    dynamo: DynamoClient,
    http: reqwest::Client,
    openai_api_key: String,
}

async fn handler(event: LambdaEvent<Value>, state: Arc<AppState>) -> Result<Value, Error> {
    let records = event
        .payload
        .get("Records")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut processed = 0_u32;
    let mut skipped = 0_u32;
    let mut failures: Vec<Value> = Vec::new();

    for record in records {
        let sequence = record
            .pointer("/dynamodb/SequenceNumber")
            .and_then(Value::as_str)
            .or_else(|| record.get("eventID").and_then(Value::as_str))
            .unwrap_or_default()
            .to_string();
        match process_record(&record, &state).await {
            Ok(RecordOutcome::Processed) => processed += 1,
            Ok(RecordOutcome::Skipped) => skipped += 1,
            Err(error) => {
                error!(sequence, error = %format_error_chain(&error), "failed to process console chat stream record");
                if !sequence.is_empty() {
                    failures.push(json!({ "itemIdentifier": sequence }));
                }
            }
        }
    }

    Ok(json!({
        "processed": processed,
        "skipped": skipped,
        "batchItemFailures": failures,
    }))
}

enum RecordOutcome {
    Processed,
    Skipped,
}

async fn process_record(record: &Value, state: &AppState) -> Result<RecordOutcome> {
    if record.get("eventName").and_then(Value::as_str) != Some("INSERT") {
        return Ok(RecordOutcome::Skipped);
    }
    let image = record
        .pointer("/dynamodb/NewImage")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("DynamoDB stream record did not include NewImage"))?;
    let message = ChatMessage::from_stream_image(image)?;
    if !message.should_handle(&state.config.response_target) {
        return Ok(RecordOutcome::Skipped);
    }
    info!(
        message_id = message.id,
        thread_id = message.thread_id,
        sequence = message.sequence_number,
        "processing console chat message"
    );
    if !claim_message(state, &message).await? {
        return Ok(RecordOutcome::Skipped);
    }
    let lock_owner = format!(
        "{}:{}",
        std::env::var("AWS_LAMBDA_FUNCTION_NAME")
            .unwrap_or_else(|_| "papyrus-console-chat-responder".to_string()),
        Uuid::new_v4()
    );
    acquire_thread_lock(state, &message, &lock_owner).await?;
    let result = answer_claimed_message(state, &message, &lock_owner).await;
    if let Err(error) = &result {
        mark_message_failed(state, &message, error).await?;
        release_thread_lock(state, &message, &lock_owner, None).await?;
    }
    result?;
    Ok(RecordOutcome::Processed)
}

async fn answer_claimed_message(
    state: &AppState,
    message: &ChatMessage,
    lock_owner: &str,
) -> Result<()> {
    let mut context = load_prompt_context(state, message).await?;
    let starting_sequence = context.last_sequence_number.max(message.sequence_number);
    let tool_and_assistant = run_agent_turn(state, message, &context).await?;
    let now = now_iso();
    let mut next_sequence = starting_sequence + 1;
    let mut persisted_messages = Vec::new();

    for tool_message in tool_and_assistant.tool_messages {
        let record = PersistedMessage {
            id: format!("message-console-tool-{}", Uuid::new_v4()),
            thread_id: message.thread_id.clone(),
            parent_message_id: Some(message.id.clone()),
            sequence_number: next_sequence,
            role: tool_message.role,
            message_kind: tool_message.message_kind,
            message_type: tool_message.message_type,
            content: tool_message.content,
            summary: tool_message.summary,
            metadata: tool_message.metadata,
        };
        put_message(state, &record, &now).await?;
        context
            .recent_messages
            .push(CachedPromptMessage::from_persisted(&record));
        persisted_messages.push(record);
        next_sequence += 1;
    }

    let assistant_summary = truncate_summary(&tool_and_assistant.assistant_content);
    let assistant_record = PersistedMessage {
        id: format!("message-console-assistant-{}", Uuid::new_v4()),
        thread_id: message.thread_id.clone(),
        parent_message_id: Some(message.id.clone()),
        sequence_number: next_sequence,
        role: "ASSISTANT".to_string(),
        message_kind: MESSAGE_KIND_CHAT_TURN.to_string(),
        message_type: "MESSAGE".to_string(),
        content: tool_and_assistant.assistant_content,
        summary: assistant_summary,
        metadata: json!({
            "responder": "rust-lambda",
            "model": state.config.model,
            "triggerMessageId": message.id,
            "triggerCreatedAt": message.created_at,
        }),
    };
    put_message(state, &assistant_record, &now).await?;
    context
        .recent_messages
        .push(CachedPromptMessage::from_persisted(&assistant_record));
    persisted_messages.push(assistant_record.clone());

    context.last_sequence_number = assistant_record.sequence_number;
    context.last_message_id = assistant_record.id.clone();
    trim_recent_messages(&mut context.recent_messages);
    context.context_digest = compute_context_digest(&context);
    context.updated_at = now.clone();
    write_context_cache(&state.config.cache_root, &context)?;

    mark_message_completed(state, message).await?;
    release_thread_lock(state, message, lock_owner, Some(&context)).await?;
    info!(
        message_id = message.id,
        thread_id = message.thread_id,
        assistant_message_id = assistant_record.id,
        persisted = persisted_messages.len(),
        cache_digest = context.context_digest,
        "console chat message completed"
    );
    Ok(())
}

#[derive(Debug, Clone)]
struct ChatMessage {
    id: String,
    thread_id: String,
    role: String,
    message_kind: String,
    message_type: String,
    content: String,
    response_target: String,
    response_status: String,
    sequence_number: i64,
    created_at: String,
    metadata: Value,
}

impl ChatMessage {
    fn from_stream_image(image: &serde_json::Map<String, Value>) -> Result<Self> {
        let metadata = image
            .get("metadata")
            .map(dynamodb_json_to_value)
            .unwrap_or(Value::Null);
        Ok(Self {
            id: stream_string(image, "id")?,
            thread_id: stream_string(image, "threadId")?,
            role: stream_string(image, "role").unwrap_or_default(),
            message_kind: stream_string(image, "messageKind")?,
            message_type: stream_string(image, "messageType")
                .unwrap_or_else(|_| "MESSAGE".to_string()),
            content: stream_string(image, "content")
                .or_else(|_| stream_string(image, "summary"))?,
            response_target: stream_string(image, "responseTarget").unwrap_or_default(),
            response_status: stream_string(image, "responseStatus").unwrap_or_default(),
            sequence_number: stream_i64(image, "sequenceNumber").unwrap_or(0),
            created_at: stream_string(image, "createdAt").unwrap_or_else(|_| now_iso()),
            metadata,
        })
    }

    fn should_handle(&self, expected_target: &str) -> bool {
        self.message_kind == MESSAGE_KIND_CHAT_TURN
            && self.role == "USER"
            && self.message_type == "MESSAGE"
            && self.response_status == "PENDING"
            && self.response_target == expected_target
            && !self.thread_id.is_empty()
            && !self.content.trim().is_empty()
    }
}

async fn claim_message(state: &AppState, message: &ChatMessage) -> Result<bool> {
    let response = state
        .dynamo
        .update_item()
        .table_name(&state.config.message_table)
        .key("id", av_s(&message.id))
        .update_expression("SET responseStatus = :running, responseOwner = :owner, responseStartedAt = :now, updatedAt = :now")
        .condition_expression("responseStatus = :pending")
        .expression_attribute_values(":running", av_s("RUNNING"))
        .expression_attribute_values(":pending", av_s("PENDING"))
        .expression_attribute_values(":owner", av_s("rust-lambda"))
        .expression_attribute_values(":now", av_s(&now_iso()))
        .send()
        .await;
    match response {
        Ok(_) => Ok(true),
        Err(error) => {
            let text = error.to_string();
            if text.contains("ConditionalCheckFailed")
                || text.contains("conditional request failed")
            {
                warn!(message_id = message.id, "message was already claimed");
                Ok(false)
            } else {
                Err(error).context("claim console chat message")
            }
        }
    }
}

async fn acquire_thread_lock(state: &AppState, message: &ChatMessage, owner: &str) -> Result<()> {
    let now = now_iso();
    let expires = (Utc::now() + Duration::seconds(300)).to_rfc3339();
    state
        .dynamo
        .update_item()
        .table_name(&state.config.thread_table)
        .key("id", av_s(&message.thread_id))
        .update_expression("SET activeResponseMessageId = :messageId, responseLockOwner = :owner, responseLockExpiresAt = :expires, updatedAt = :now")
        .condition_expression("attribute_not_exists(responseLockExpiresAt) OR responseLockExpiresAt < :now OR activeResponseMessageId = :messageId")
        .expression_attribute_values(":messageId", av_s(&message.id))
        .expression_attribute_values(":owner", av_s(owner))
        .expression_attribute_values(":expires", av_s(&expires))
        .expression_attribute_values(":now", av_s(&now))
        .send()
        .await
        .context("acquire MessageThread response lock")?;
    Ok(())
}

async fn release_thread_lock(
    state: &AppState,
    message: &ChatMessage,
    owner: &str,
    context: Option<&ThreadContextCache>,
) -> Result<()> {
    let now = now_iso();
    let mut update = state
        .dynamo
        .update_item()
        .table_name(&state.config.thread_table)
        .key("id", av_s(&message.thread_id))
        .condition_expression("responseLockOwner = :owner")
        .expression_attribute_values(":owner", av_s(owner))
        .expression_attribute_values(":now", av_s(&now));

    if let Some(context) = context {
        update = update
            .update_expression("SET lastMessageId = :lastMessageId, lastMessageAt = :lastMessageAt, contextDigest = :contextDigest, messageCount = :messageCount, updatedAt = :now REMOVE activeResponseMessageId, responseLockOwner, responseLockExpiresAt")
            .expression_attribute_values(":lastMessageId", av_s(&context.last_message_id))
            .expression_attribute_values(":lastMessageAt", av_s(&context.updated_at))
            .expression_attribute_values(":contextDigest", av_s(&context.context_digest))
            .expression_attribute_values(":messageCount", AttributeValue::N(context.last_sequence_number.to_string()));
    } else {
        update = update.update_expression("SET updatedAt = :now REMOVE activeResponseMessageId, responseLockOwner, responseLockExpiresAt");
    }

    match update.send().await {
        Ok(_) => Ok(()),
        Err(error) => {
            warn!(thread_id = message.thread_id, error = %error, "failed to release thread lock");
            Ok(())
        }
    }
}

async fn mark_message_completed(state: &AppState, message: &ChatMessage) -> Result<()> {
    let now = now_iso();
    state
        .dynamo
        .update_item()
        .table_name(&state.config.message_table)
        .key("id", av_s(&message.id))
        .update_expression(
            "SET responseStatus = :completed, responseCompletedAt = :now, updatedAt = :now",
        )
        .expression_attribute_values(":completed", av_s("COMPLETED"))
        .expression_attribute_values(":now", av_s(&now))
        .send()
        .await
        .context("mark console chat message completed")?;
    Ok(())
}

async fn mark_message_failed(
    state: &AppState,
    message: &ChatMessage,
    error: &anyhow::Error,
) -> Result<()> {
    let now = now_iso();
    state
        .dynamo
        .update_item()
        .table_name(&state.config.message_table)
        .key("id", av_s(&message.id))
        .update_expression("SET responseStatus = :failed, responseCompletedAt = :now, responseError = :error, updatedAt = :now")
        .expression_attribute_values(":failed", av_s("FAILED"))
        .expression_attribute_values(":now", av_s(&now))
        .expression_attribute_values(":error", av_s(&error.to_string()))
        .send()
        .await
        .context("mark console chat message failed")?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ThreadContextCache {
    schema_version: u32,
    thread_id: String,
    last_sequence_number: i64,
    last_message_id: String,
    context_digest: String,
    rolling_summary: String,
    recent_messages: Vec<CachedPromptMessage>,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedPromptMessage {
    id: String,
    sequence_number: i64,
    role: String,
    content: String,
}

impl CachedPromptMessage {
    fn from_chat(message: &ChatMessage) -> Self {
        Self {
            id: message.id.clone(),
            sequence_number: message.sequence_number,
            role: message.role.clone(),
            content: message.content.clone(),
        }
    }

    fn from_persisted(message: &PersistedMessage) -> Self {
        Self {
            id: message.id.clone(),
            sequence_number: message.sequence_number,
            role: message.role.clone(),
            content: message.content.clone(),
        }
    }
}

async fn load_prompt_context(
    state: &AppState,
    message: &ChatMessage,
) -> Result<ThreadContextCache> {
    if let Some(mut cache) = read_context_cache(&state.config.cache_root, &message.thread_id)? {
        if cache_is_valid_for_message(&cache, message) {
            if !cache
                .recent_messages
                .iter()
                .any(|entry| entry.id == message.id)
            {
                cache
                    .recent_messages
                    .push(CachedPromptMessage::from_chat(message));
                cache.last_sequence_number = message.sequence_number;
                cache.last_message_id = message.id.clone();
                trim_recent_messages(&mut cache.recent_messages);
            }
            info!(
                thread_id = message.thread_id,
                "loaded prompt context from /tmp cache"
            );
            return Ok(cache);
        }
    }
    let mut cache = match rebuild_context_from_dynamodb(state, message).await {
        Ok(cache) => cache,
        Err(error) => {
            warn!(
                thread_id = message.thread_id,
                error = %format_error_chain(&error),
                "failed to rebuild prompt context from DynamoDB; falling back to trigger message only"
            );
            one_message_context(message)
        }
    };
    if !cache
        .recent_messages
        .iter()
        .any(|entry| entry.id == message.id)
    {
        cache
            .recent_messages
            .push(CachedPromptMessage::from_chat(message));
    }
    cache.last_sequence_number = cache
        .recent_messages
        .iter()
        .map(|entry| entry.sequence_number)
        .max()
        .unwrap_or(message.sequence_number);
    cache.last_message_id = cache
        .recent_messages
        .iter()
        .max_by_key(|entry| entry.sequence_number)
        .map(|entry| entry.id.clone())
        .unwrap_or_else(|| message.id.clone());
    trim_recent_messages(&mut cache.recent_messages);
    cache.context_digest = compute_context_digest(&cache);
    write_context_cache(&state.config.cache_root, &cache)?;
    info!(
        thread_id = message.thread_id,
        "rebuilt prompt context from DynamoDB"
    );
    Ok(cache)
}

fn one_message_context(message: &ChatMessage) -> ThreadContextCache {
    let mut cache = ThreadContextCache {
        schema_version: CONTEXT_CACHE_SCHEMA_VERSION,
        thread_id: message.thread_id.clone(),
        last_sequence_number: message.sequence_number,
        last_message_id: message.id.clone(),
        context_digest: String::new(),
        rolling_summary: String::new(),
        recent_messages: vec![CachedPromptMessage::from_chat(message)],
        updated_at: now_iso(),
    };
    cache.context_digest = compute_context_digest(&cache);
    cache
}

fn cache_is_valid_for_message(cache: &ThreadContextCache, message: &ChatMessage) -> bool {
    if cache.schema_version != CONTEXT_CACHE_SCHEMA_VERSION || cache.thread_id != message.thread_id
    {
        return false;
    }
    let previous_sequence = message
        .metadata
        .get("previousSequenceNumber")
        .and_then(Value::as_i64)
        .unwrap_or(message.sequence_number - 1);
    let previous_digest = message
        .metadata
        .get("previousContextDigest")
        .and_then(Value::as_str);
    cache.last_sequence_number == previous_sequence
        && previous_digest
            .map(|digest| digest == cache.context_digest)
            .unwrap_or(true)
}

async fn rebuild_context_from_dynamodb(
    state: &AppState,
    message: &ChatMessage,
) -> Result<ThreadContextCache> {
    let result = state
        .dynamo
        .query()
        .table_name(&state.config.message_table)
        .index_name(&state.config.thread_sequence_index)
        .key_condition_expression("threadId = :threadId")
        .expression_attribute_values(":threadId", av_s(&message.thread_id))
        .scan_index_forward(false)
        .limit(32)
        .send()
        .await
        .context("query Message tail by threadId/sequenceNumber")?;
    let mut messages: Vec<CachedPromptMessage> = result
        .items()
        .iter()
        .filter_map(cached_message_from_item)
        .collect();
    messages.sort_by_key(|entry| entry.sequence_number);
    trim_recent_messages(&mut messages);
    let last = messages
        .iter()
        .max_by_key(|entry| entry.sequence_number)
        .cloned()
        .unwrap_or_else(|| CachedPromptMessage::from_chat(message));
    let mut cache = ThreadContextCache {
        schema_version: CONTEXT_CACHE_SCHEMA_VERSION,
        thread_id: message.thread_id.clone(),
        last_sequence_number: last.sequence_number,
        last_message_id: last.id,
        context_digest: String::new(),
        rolling_summary: String::new(),
        recent_messages: messages,
        updated_at: now_iso(),
    };
    cache.context_digest = compute_context_digest(&cache);
    Ok(cache)
}

fn cached_message_from_item(item: &HashMap<String, AttributeValue>) -> Option<CachedPromptMessage> {
    let role = attr_string(item.get("role"))?;
    if role != "USER" && role != "ASSISTANT" {
        return None;
    }
    let message_type =
        attr_string(item.get("messageType")).unwrap_or_else(|| "MESSAGE".to_string());
    if message_type != "MESSAGE" {
        return None;
    }
    Some(CachedPromptMessage {
        id: attr_string(item.get("id"))?,
        sequence_number: attr_i64(item.get("sequenceNumber")).unwrap_or(0),
        role,
        content: attr_string(item.get("content")).or_else(|| attr_string(item.get("summary")))?,
    })
}

fn read_context_cache(root: &Path, thread_id: &str) -> Result<Option<ThreadContextCache>> {
    let path = context_cache_path(root, thread_id);
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)
        .with_context(|| format!("read context cache {}", path.display()))?;
    let cache = serde_json::from_str(&text)
        .with_context(|| format!("parse context cache {}", path.display()))?;
    Ok(Some(cache))
}

fn write_context_cache(root: &Path, cache: &ThreadContextCache) -> Result<()> {
    fs::create_dir_all(root)
        .with_context(|| format!("create context cache directory {}", root.display()))?;
    let path = context_cache_path(root, &cache.thread_id);
    let tmp_path = path.with_extension("json.tmp");
    let text = serde_json::to_string(cache)?;
    fs::write(&tmp_path, text)
        .with_context(|| format!("write context cache {}", tmp_path.display()))?;
    fs::rename(&tmp_path, &path)
        .with_context(|| format!("move context cache {}", path.display()))?;
    Ok(())
}

fn context_cache_path(root: &Path, thread_id: &str) -> PathBuf {
    let safe = thread_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    root.join(format!("{safe}.json"))
}

fn trim_recent_messages(messages: &mut Vec<CachedPromptMessage>) {
    messages.sort_by_key(|entry| entry.sequence_number);
    messages.dedup_by(|left, right| left.id == right.id);
    if messages.len() > 24 {
        let drop_count = messages.len() - 24;
        messages.drain(0..drop_count);
    }
}

fn compute_context_digest(cache: &ThreadContextCache) -> String {
    let mut hasher = Sha256::new();
    hasher.update(cache.thread_id.as_bytes());
    hasher.update(cache.last_sequence_number.to_string().as_bytes());
    for message in &cache.recent_messages {
        hasher.update(message.id.as_bytes());
        hasher.update(message.role.as_bytes());
        hasher.update(message.content.as_bytes());
    }
    to_hex(&hasher.finalize())
}

#[derive(Debug, Clone)]
struct PersistedMessage {
    id: String,
    thread_id: String,
    parent_message_id: Option<String>,
    sequence_number: i64,
    role: String,
    message_kind: String,
    message_type: String,
    content: String,
    summary: String,
    metadata: Value,
}

async fn put_message(state: &AppState, message: &PersistedMessage, now: &str) -> Result<()> {
    let mut item = HashMap::from([
        ("id".to_string(), av_s(&message.id)),
        ("threadId".to_string(), av_s(&message.thread_id)),
        (
            "sequenceNumber".to_string(),
            AttributeValue::N(message.sequence_number.to_string()),
        ),
        ("role".to_string(), av_s(&message.role)),
        ("messageKind".to_string(), av_s(&message.message_kind)),
        (
            "messageDomain".to_string(),
            av_s(MESSAGE_DOMAIN_CONVERSATION),
        ),
        ("messageType".to_string(), av_s(&message.message_type)),
        ("status".to_string(), av_s("active")),
        ("summary".to_string(), av_s(&message.summary)),
        ("content".to_string(), av_s(&message.content)),
        ("semanticLayer".to_string(), av_s(CHAT_DETAIL_LAYER)),
        ("searchVisibility".to_string(), av_s(EXPLICIT_SEARCH)),
        ("source".to_string(), av_s("papyrus-console")),
        (
            "newsroomFeedKey".to_string(),
            av_s(NEWSROOM_FEED_CONSOLE_CHAT),
        ),
        ("createdAt".to_string(), av_s(now)),
        ("updatedAt".to_string(), av_s(now)),
        ("metadata".to_string(), json_to_attr(&message.metadata)),
    ]);
    if let Some(parent_id) = &message.parent_message_id {
        item.insert("parentMessageId".to_string(), av_s(parent_id));
    }
    state
        .dynamo
        .put_item()
        .table_name(&state.config.message_table)
        .set_item(Some(item))
        .send()
        .await
        .context("put console responder Message")?;
    Ok(())
}

#[derive(Debug)]
struct AgentTurnOutput {
    assistant_content: String,
    tool_messages: Vec<PersistedToolMessage>,
}

#[derive(Debug)]
struct PersistedToolMessage {
    role: String,
    message_kind: String,
    message_type: String,
    content: String,
    summary: String,
    metadata: Value,
}

async fn run_agent_turn(
    state: &AppState,
    trigger: &ChatMessage,
    context: &ThreadContextCache,
) -> Result<AgentTurnOutput> {
    let mut messages = build_openai_messages(context);
    let request = openai_request(&state.config.model, messages.clone());
    let first = send_openai_chat(state, request).await?;
    let tool_calls = first
        .get("tool_calls")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if tool_calls.is_empty() {
        return Ok(AgentTurnOutput {
            assistant_content: first
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("I could not generate a response.")
                .to_string(),
            tool_messages: Vec::new(),
        });
    }

    let mut persisted_tool_messages = Vec::new();
    messages.push(json!({
        "role": "assistant",
        "content": first.get("content").cloned().unwrap_or(Value::Null),
        "tool_calls": tool_calls,
    }));
    for call in tool_calls {
        let call_id = call
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("tool-call");
        let function = call
            .get("function")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let name = function
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("execute_papyrus");
        let arguments = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("{}");
        let tool_result = execute_papyrus_tool(trigger, context, name, arguments);
        persisted_tool_messages.push(PersistedToolMessage {
            role: "TOOL".to_string(),
            message_kind: MESSAGE_KIND_TOOL_CALL.to_string(),
            message_type: "TOOL_CALL".to_string(),
            content: arguments.to_string(),
            summary: truncate_summary(&format!("{name} tool call")),
            metadata: json!({ "toolCallId": call_id, "toolName": name, "arguments": arguments }),
        });
        persisted_tool_messages.push(PersistedToolMessage {
            role: "TOOL".to_string(),
            message_kind: MESSAGE_KIND_TOOL_RESULT.to_string(),
            message_type: "TOOL_RESPONSE".to_string(),
            content: tool_result.to_string(),
            summary: truncate_summary(&format!("{name} tool result")),
            metadata: json!({ "toolCallId": call_id, "toolName": name }),
        });
        messages.push(json!({
            "role": "tool",
            "tool_call_id": call_id,
            "content": tool_result.to_string(),
        }));
    }

    let second = send_openai_chat(state, openai_request(&state.config.model, messages)).await?;
    Ok(AgentTurnOutput {
        assistant_content: second
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or(
                "I used the available Papyrus context but could not generate a final response.",
            )
            .to_string(),
        tool_messages: persisted_tool_messages,
    })
}

fn build_openai_messages(context: &ThreadContextCache) -> Vec<Value> {
    let mut messages = vec![json!({
        "role": "system",
        "content": "You are the Papyrus Console assistant for an editor-facing autonomous newsroom. Be concise, accurate, and concrete. Raw console chat turns are detailed working memory and are excluded from default semantic searches unless explicitly requested. When a chat produces durable insight, recommend creating an insight Message rather than making every chat turn canonical knowledge. You may call execute_papyrus for local Papyrus context."
    })];
    if !context.rolling_summary.trim().is_empty() {
        messages.push(json!({
            "role": "system",
            "content": format!("Thread rolling summary:\n{}", context.rolling_summary)
        }));
    }
    for cached in &context.recent_messages {
        let role = match cached.role.as_str() {
            "ASSISTANT" => "assistant",
            "USER" => "user",
            _ => continue,
        };
        if !cached.content.trim().is_empty() {
            messages.push(json!({ "role": role, "content": cached.content }));
        }
    }
    messages
}

fn openai_request(model: &str, messages: Vec<Value>) -> Value {
    json!({
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "execute_papyrus",
                    "description": "Inspect a small, whitelisted slice of the current Papyrus console runtime context.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "operation": {
                                "type": "string",
                                "enum": ["help", "thread_context", "recent_messages"]
                            },
                            "arguments": { "type": "object" }
                        },
                        "required": ["operation"]
                    }
                }
            }
        ],
        "tool_choice": "auto"
    })
}

async fn send_openai_chat(state: &AppState, body: Value) -> Result<Value> {
    let response = state
        .http
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(&state.openai_api_key)
        .json(&body)
        .send()
        .await
        .context("send OpenAI chat completion")?;
    let status = response.status();
    let payload: Value = response.json().await.context("parse OpenAI response")?;
    if !status.is_success() {
        return Err(anyhow!(
            "OpenAI chat completion failed with {status}: {payload}"
        ));
    }
    payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .cloned()
        .ok_or_else(|| anyhow!("OpenAI response did not include choices[0].message"))
}

fn execute_papyrus_tool(
    trigger: &ChatMessage,
    context: &ThreadContextCache,
    name: &str,
    arguments: &str,
) -> Value {
    if name != "execute_papyrus" {
        return json!({ "ok": false, "error": format!("Unsupported tool {name}") });
    }
    let parsed: Value = serde_json::from_str(arguments).unwrap_or_else(|_| json!({}));
    match parsed
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("help")
    {
        "thread_context" => json!({
            "ok": true,
            "threadId": trigger.thread_id,
            "triggerMessageId": trigger.id,
            "triggerSequenceNumber": trigger.sequence_number,
            "cacheDigest": context.context_digest,
            "cachedRecentMessageCount": context.recent_messages.len(),
            "lastCachedSequenceNumber": context.last_sequence_number,
        }),
        "recent_messages" => json!({
            "ok": true,
            "messages": context.recent_messages.iter().map(|entry| json!({
                "id": entry.id,
                "sequenceNumber": entry.sequence_number,
                "role": entry.role,
                "content": entry.content,
            })).collect::<Vec<Value>>(),
        }),
        _ => json!({
            "ok": true,
            "operations": ["help", "thread_context", "recent_messages"],
            "note": "This Rust tool surface is intentionally small and whitelisted; protected Papyrus mutations should use dedicated GraphQL actions."
        }),
    }
}

async fn load_openai_api_key(ssm: &SsmClient, config: &AppConfig) -> Result<String> {
    if let Some(value) = optional_env("OPENAI_API_KEY") {
        return Ok(value);
    }
    let Some(parameter_name) = &config.openai_api_key_ssm_param else {
        return Err(anyhow!(
            "OPENAI_API_KEY or PAPYRUS_CONSOLE_OPENAI_API_KEY_SSM_PARAM is required"
        ));
    };
    let response = ssm
        .get_parameter()
        .name(parameter_name)
        .with_decryption(true)
        .send()
        .await
        .context("load OpenAI API key from SSM")?;
    response
        .parameter()
        .and_then(|parameter| parameter.value())
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("SSM parameter {parameter_name} did not include a value"))
}

fn dynamodb_json_to_value(value: &Value) -> Value {
    if let Some(s) = value.get("S").and_then(Value::as_str) {
        return Value::String(s.to_string());
    }
    if let Some(n) = value.get("N").and_then(Value::as_str) {
        return n
            .parse::<i64>()
            .map(Value::from)
            .unwrap_or_else(|_| Value::String(n.to_string()));
    }
    if let Some(b) = value.get("BOOL").and_then(Value::as_bool) {
        return Value::Bool(b);
    }
    if value.get("NULL").and_then(Value::as_bool).unwrap_or(false) {
        return Value::Null;
    }
    if let Some(map) = value.get("M").and_then(Value::as_object) {
        return Value::Object(
            map.iter()
                .map(|(key, entry)| (key.clone(), dynamodb_json_to_value(entry)))
                .collect(),
        );
    }
    if let Some(list) = value.get("L").and_then(Value::as_array) {
        return Value::Array(list.iter().map(dynamodb_json_to_value).collect());
    }
    Value::Null
}

fn json_to_attr(value: &Value) -> AttributeValue {
    match value {
        Value::Null => AttributeValue::Null(true),
        Value::Bool(value) => AttributeValue::Bool(*value),
        Value::Number(number) => AttributeValue::N(number.to_string()),
        Value::String(value) => AttributeValue::S(value.clone()),
        Value::Array(values) => AttributeValue::L(values.iter().map(json_to_attr).collect()),
        Value::Object(map) => AttributeValue::M(
            map.iter()
                .map(|(key, value)| (key.clone(), json_to_attr(value)))
                .collect(),
        ),
    }
}

fn stream_string(image: &serde_json::Map<String, Value>, key: &str) -> Result<String> {
    image
        .get(key)
        .map(dynamodb_json_to_value)
        .and_then(|value| value.as_str().map(str::to_string))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("missing DynamoDB stream string field {key}"))
}

fn stream_i64(image: &serde_json::Map<String, Value>, key: &str) -> Option<i64> {
    image
        .get(key)
        .map(dynamodb_json_to_value)
        .and_then(|value| value.as_i64())
}

fn attr_string(value: Option<&AttributeValue>) -> Option<String> {
    value.and_then(|attr| attr.as_s().ok().cloned())
}

fn attr_i64(value: Option<&AttributeValue>) -> Option<i64> {
    value
        .and_then(|attr| attr.as_n().ok())
        .and_then(|value| value.parse::<i64>().ok())
}

fn av_s(value: &str) -> AttributeValue {
    AttributeValue::S(value.to_string())
}

fn truncate_summary(value: &str) -> String {
    let text = value.trim().replace('\n', " ");
    if text.chars().count() <= 180 {
        return text;
    }
    format!("{}…", text.chars().take(179).collect::<String>())
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn required_env(name: &str) -> String {
    optional_env(name).unwrap_or_else(|| panic!("{name} is required"))
}

fn env_or(name: &str, fallback: &str) -> String {
    optional_env(name).unwrap_or_else(|| fallback.to_string())
}

fn optional_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn format_error_chain(error: &anyhow::Error) -> String {
    error
        .chain()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(": ")
}

fn to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_cache_validation_accepts_matching_previous_cursor() {
        let cache = ThreadContextCache {
            schema_version: CONTEXT_CACHE_SCHEMA_VERSION,
            thread_id: "thread-1".to_string(),
            last_sequence_number: 2,
            last_message_id: "message-2".to_string(),
            context_digest: "digest".to_string(),
            rolling_summary: String::new(),
            recent_messages: Vec::new(),
            updated_at: now_iso(),
        };
        let message = ChatMessage {
            id: "message-3".to_string(),
            thread_id: "thread-1".to_string(),
            role: "USER".to_string(),
            message_kind: MESSAGE_KIND_CHAT_TURN.to_string(),
            message_type: "MESSAGE".to_string(),
            content: "Hello".to_string(),
            response_target: DEFAULT_RESPONSE_TARGET.to_string(),
            response_status: "PENDING".to_string(),
            sequence_number: 3,
            created_at: now_iso(),
            metadata: json!({ "previousSequenceNumber": 2, "previousContextDigest": "digest" }),
        };
        assert!(cache_is_valid_for_message(&cache, &message));
    }

    #[test]
    fn context_cache_validation_rejects_stale_cursor() {
        let cache = ThreadContextCache {
            schema_version: CONTEXT_CACHE_SCHEMA_VERSION,
            thread_id: "thread-1".to_string(),
            last_sequence_number: 1,
            last_message_id: "message-1".to_string(),
            context_digest: "digest".to_string(),
            rolling_summary: String::new(),
            recent_messages: Vec::new(),
            updated_at: now_iso(),
        };
        let message = ChatMessage {
            id: "message-3".to_string(),
            thread_id: "thread-1".to_string(),
            role: "USER".to_string(),
            message_kind: MESSAGE_KIND_CHAT_TURN.to_string(),
            message_type: "MESSAGE".to_string(),
            content: "Hello".to_string(),
            response_target: DEFAULT_RESPONSE_TARGET.to_string(),
            response_status: "PENDING".to_string(),
            sequence_number: 3,
            created_at: now_iso(),
            metadata: json!({ "previousSequenceNumber": 2, "previousContextDigest": "digest" }),
        };
        assert!(!cache_is_valid_for_message(&cache, &message));
    }
}
