FROM golang:1.25 AS build
WORKDIR /src
COPY . .
RUN go build -o /bin/sandbox-runner ./cmd/server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /bin/sandbox-runner /bin/sandbox-runner
EXPOSE 8090
ENV SANDBOX_ADDR=:8090
ENTRYPOINT ["/bin/sandbox-runner"]
