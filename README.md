# ☁️ Cloudflare Worker S3 Proxy

A lightweight, **read-only** S3 protocol proxy gateway built on [Cloudflare Workers](https://workers.cloudflare.com/).

Leverages the [Cloudflare × Backblaze B2 Bandwidth Alliance](https://www.backblaze.com/cloud-storage/integrations/cloudflare) to achieve **egress-free** downloads from private B2 buckets — ideal for backing up NAS, servers, and other infrastructure without paying Backblaze download fees.

```
┌──────────┐  fake AK/SK   ┌─────────────────┐  real SigV4   ┌──────────────┐
│  Client  │ ─────────────► │  CF Worker      │ ────────────► │  Backblaze   │
│ (rclone) │ ◄───────────── │  (this proxy)   │ ◄──────────── │  B2 S3 API   │
└──────────┘   data stream  └─────────────────┘  data stream  └──────────────┘
                              ▲ Bandwidth Alliance = $0 egress
```

## ✨ Features

- 🔒 **Read-only by design** — only `GET` and `HEAD` are allowed; write operations are rejected
- 🔑 **Simple passphrase authentication** — clients use a shared Access Key as a gateway pass
- 📦 **Multi-bucket support** — route multiple buckets to different B2 credentials via JSON config
- 🌐 **CORS enabled** — ready for browser-based debugging and web client access
- 📋 **Standard S3 XML errors** — fully compatible with aws-cli, rclone, and all S3 SDKs
- ⚡ **Zero egress fees** — Cloudflare ↔ Backblaze B2 traffic is free via the Bandwidth Alliance
- 🪶 **Minimal dependencies** — only [`aws4fetch`](https://github.com/mhart/aws4fetch) for request signing

## 📁 Project Structure

```
cloudflare-s3-proxy/
├── src/
│   ├── index.ts       # Worker entry point & request pipeline
│   ├── types.ts       # TypeScript type definitions
│   ├── auth.ts        # Access key extraction & validation
│   ├── parser.ts      # S3 path-style URL parser
│   ├── errors.ts      # S3 XML error response builder
│   ├── cors.ts        # CORS headers & preflight handling
│   └── proxy.ts       # B2 request signing & forwarding
├── wrangler.toml      # Wrangler deployment config
├── tsconfig.json      # TypeScript configuration
├── package.json       # Project manifest
├── .dev.vars.example  # Local dev environment template
└── .gitignore
```

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is fine)
- A [Backblaze B2](https://www.backblaze.com/b2/cloud-storage.html) account with an S3-compatible bucket

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Local Development

Copy the example environment file and fill in your real values:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```ini
PROXY_ACCESS_KEY=my-secret-proxy-passphrase
BUCKET_CONFIG_JSON={"my-bucket":{"ak":"005xxxxxxxxxxxx000000001","sk":"K005xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","region":"us-west-004"}}
```

| Variable | Description |
|---|---|
| `PROXY_ACCESS_KEY` | The passphrase clients must present as their S3 Access Key ID |
| `BUCKET_CONFIG_JSON` | JSON mapping of bucket names → real B2 credentials |

#### `BUCKET_CONFIG_JSON` Format

```json
{
  "bucket-name-1": {
    "ak": "Backblaze_B2_Key_ID",
    "sk": "Backblaze_B2_Application_Key",
    "region": "us-west-004"
  },
  "bucket-name-2": {
    "ak": "Another_Key_ID",
    "sk": "Another_App_Key",
    "region": "eu-central-003"
  }
}
```

> **Finding your B2 region**: Go to Backblaze B2 → Buckets → look at the **Endpoint** column.
> It will look like `s3.us-west-004.backblazeb2.com` — the region is `us-west-004`.

### 3. Start the Dev Server

```bash
npm run dev
```

The proxy will be available at `http://localhost:8787`.

### 4. Test with cURL

```bash
# Health check (root path)
curl http://localhost:8787/

# Download an object (with fake auth header)
curl -H "Authorization: AWS4-HMAC-SHA256 Credential=my-secret-proxy-passphrase/20250101/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=fake" \
  http://localhost:8787/my-bucket/path/to/file.txt
```

## 🌍 Deployment

### 1. Set Secrets

**Never** put real credentials in `wrangler.toml`. Use encrypted secrets:

```bash
npx wrangler secret put PROXY_ACCESS_KEY
# Enter your passphrase when prompted

npx wrangler secret put BUCKET_CONFIG_JSON
# Paste the JSON string when prompted
```

### 2. Deploy

```bash
npm run deploy
```

Your proxy will be live at `https://s3-proxy.<your-subdomain>.workers.dev`.

### 3. (Optional) Custom Domain

In the Cloudflare dashboard, add a Custom Domain to your Worker to use your own domain, e.g. `s3.yourdomain.com`.

## 🔧 Client Configuration

### Rclone

Add the following to your `~/.config/rclone/rclone.conf`:

```ini
[b2-proxy]
type = s3
provider = Other
access_key_id = my-secret-proxy-passphrase
secret_access_key = any-fake-value-here
endpoint = https://s3-proxy.your-subdomain.workers.dev
```

> **Note**: The `secret_access_key` can be any non-empty string — it is ignored by the proxy. Only the `access_key_id` is checked.

Usage examples:

```bash
# List objects in a bucket
rclone ls b2-proxy:my-bucket

# Copy a file from B2 through the proxy
rclone copy b2-proxy:my-bucket/backups/latest.tar.gz /local/path/

# Sync a remote directory to local
rclone sync b2-proxy:my-bucket/data/ /local/data/ --progress
```

### AWS CLI

```bash
aws configure --profile b2-proxy
# Access Key ID:     my-secret-proxy-passphrase
# Secret Access Key: any-fake-value
# Region:            us-east-1  (doesn't matter, proxy ignores it)

# Download a file
aws s3 cp s3://my-bucket/file.txt ./file.txt \
  --endpoint-url https://s3-proxy.your-subdomain.workers.dev \
  --profile b2-proxy
```

### MinIO Client (mc)

```bash
mc alias set b2proxy https://s3-proxy.your-subdomain.workers.dev my-secret-proxy-passphrase fake-secret-key

mc ls b2proxy/my-bucket/
mc cp b2proxy/my-bucket/file.txt ./file.txt
```

## ⚠️ Limitations

| Limitation | Reason |
|---|---|
| **Read-only** (`GET`/`HEAD` only) | Cloudflare Workers have a request body size limit (~100 MB free, ~500 MB paid). Uploads are intentionally blocked. |
| **Path-Style only** | Virtual-hosted-style (`bucket.endpoint`) requires wildcard DNS and is unnecessary for this use case. |
| **Single-region per bucket** | Each bucket entry in the config maps to one B2 region. This matches B2's single-region model. |

## 📄 License

[MIT](./LICENSE)