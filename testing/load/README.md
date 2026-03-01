# Cognigate API - k6 Load Tests

Load testing scripts for the Cognigate REST API using [k6](https://k6.io/) by Grafana Labs.

## Prerequisites

### Install k6

**Windows (Chocolatey):**

```bash
choco install k6
```

**Windows (winget):**

```bash
winget install k6 --source winget
```

**macOS (Homebrew):**

```bash
brew install k6
```

**Linux (Debian/Ubuntu):**

```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

**Docker:**

```bash
docker pull grafana/k6
```

Verify installation:

```bash
k6 version
```

## Test Scripts

| Script          | VUs       | Duration | Purpose                                    |
| --------------- | --------- | -------- | ------------------------------------------ |
| `k6-smoke.js`   | 1         | 30s      | Verify all endpoints work under minimal load |
| `k6-load.js`    | 10-50-10  | 5min     | Normal production load simulation           |
| `k6-stress.js`  | 10-200    | 10min    | Find breaking point under heavy load        |
| `k6-spike.js`   | 1-200-1   | ~5min    | Test recovery after sudden traffic spike    |

## Running Tests

### Start the Cognigate API

```bash
# From the repo root
pnpm --filter cognigate-api dev
```

The API starts at `http://localhost:3000` by default.

### Environment Variables

| Variable    | Default                          | Description                |
| ----------- | -------------------------------- | -------------------------- |
| `BASE_URL`  | `http://localhost:3000/api/v1`   | API base URL               |
| `API_KEY`   | `vorion-dev-key-12345`           | API key for authentication |

### Run Individual Tests

```bash
# Smoke test - quick validation
k6 run testing/load/k6-smoke.js

# Load test - sustained traffic
k6 run testing/load/k6-load.js

# Stress test - find breaking point
k6 run testing/load/k6-stress.js

# Spike test - sudden traffic burst
k6 run testing/load/k6-spike.js
```

### Run with Custom Configuration

```bash
# Target a different environment
k6 run -e BASE_URL=https://cognigate-staging.example.com/api/v1 \
       -e API_KEY=your-staging-key \
       testing/load/k6-load.js

# Run with Docker
docker run --rm -i --network=host \
  -v "$(pwd)/testing/load:/scripts" \
  grafana/k6 run /scripts/k6-smoke.js
```

### Export Results

```bash
# JSON output
k6 run --out json=results.json testing/load/k6-load.js

# CSV output
k6 run --out csv=results.csv testing/load/k6-load.js

# InfluxDB (for Grafana dashboards)
k6 run --out influxdb=http://localhost:8086/k6 testing/load/k6-load.js
```

## Thresholds

### Smoke Test

- All requests return HTTP 200 (or expected status)
- Response time < 500ms

### Load Test

- p(95) response time < 500ms
- Error rate < 1%
- Request rate > 50 req/s

### Stress Test

- p(95) response time < 2s
- Error rate < 5%

### Spike Test

- System recovers within 30s after spike
- Error rate during recovery < 10%

## Workload Distribution (Load / Stress / Spike)

| Operation          | Weight | Endpoint                          | Method |
| ------------------ | ------ | --------------------------------- | ------ |
| Trust reads        | 40%    | `GET /trust/{agentId}`            | GET    |
| Intent submissions | 30%    | `POST /intents`                   | POST   |
| Proof reads        | 20%    | `GET /proofs/entity/{entityId}`   | GET    |
| Agent CRUD         | 10%    | `POST/GET/PATCH/DELETE /agents`   | Mixed  |

## Interpreting Results

k6 outputs a summary table after each run. Key metrics to watch:

- **http_req_duration**: End-to-end request latency (check p95 and max)
- **http_req_failed**: Percentage of failed requests
- **http_reqs**: Total requests per second throughput
- **iterations**: Number of complete test iterations

Custom metrics prefixed with `cognigate_` provide per-endpoint breakdowns.
