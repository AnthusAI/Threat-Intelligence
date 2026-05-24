FROM rust:1.91.1-bookworm AS build
WORKDIR /workspace/amplify/functions/console-chat-responder

COPY amplify/functions/console-chat-responder/Cargo.toml amplify/functions/console-chat-responder/Cargo.lock ./
COPY amplify/functions/console-chat-responder/src ./src
RUN cargo build --release

FROM public.ecr.aws/lambda/provided:al2023
COPY --from=build /workspace/amplify/functions/console-chat-responder/target/release/papyrus_console_chat_responder /var/runtime/bootstrap
RUN chmod +x /var/runtime/bootstrap
CMD ["/var/runtime/bootstrap"]
