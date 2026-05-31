FROM rust:1.91.1-bookworm AS build
WORKDIR /workspace/amplify/functions/console-chat-responder

COPY amplify/functions/console-chat-responder/Cargo.toml amplify/functions/console-chat-responder/Cargo.lock ./
COPY amplify/functions/console-chat-responder/src ./src
RUN cargo build --release

FROM public.ecr.aws/lambda/provided:al2023
COPY --from=build /workspace/amplify/functions/console-chat-responder/target/release/papyrus_console_chat_responder /var/runtime/bootstrap
RUN dnf --setopt=cachedir=/tmp/dnf-cache install -y python3 python3-pip \
    && python3 -m pip install --no-cache-dir PyYAML botocore tiktoken \
    && python3 -m pip install --no-cache-dir tactus==0.44.1 \
    && dnf clean all \
    && rm -rf /tmp/dnf-cache /var/cache/dnf /var/cache/yum
COPY src /opt/papyrus/src
COPY amplify/functions/console-chat-responder/py/execute_tactus_runner.py /opt/papyrus/execute_tactus_runner.py
ENV PYTHONPATH=/opt/papyrus/src
RUN chmod +x /var/runtime/bootstrap
CMD ["/var/runtime/bootstrap"]
