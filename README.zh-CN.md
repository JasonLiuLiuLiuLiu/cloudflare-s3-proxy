# ☁️ Cloudflare Worker S3 代理网关

一个基于 [Cloudflare Workers](https://workers.cloudflare.com/) 构建的轻量级**只读** S3 协议代理网关。

利用 [Cloudflare × Backblaze B2 带宽联盟 (Bandwidth Alliance)](https://www.backblaze.com/cloud-storage/integrations/cloudflare)，实现从私有 B2 存储桶**零出站流量费**下载数据 —— 适用于 NAS 备份还原、服务器数据拉取等场景。

```
┌──────────┐  伪造 AK/SK   ┌─────────────────┐  真实 SigV4   ┌──────────────┐
│  客户端  │ ─────────────► │  CF Worker      │ ────────────► │  Backblaze   │
│ (rclone) │ ◄───────────── │  (本代理)       │ ◄──────────── │  B2 S3 API   │
└──────────┘   数据流透传   └─────────────────┘   数据流透传  └──────────────┘
                              ▲ 带宽联盟 = 出站流量 $0
```

## ✨ 功能特性

- 🔒 **只读设计** — 仅允许 `GET` 和 `HEAD`，写入操作一律拒绝并返回 405
- 🔑 **简单口令认证** — 客户端使用共享的 Access Key 作为网关通行证
- 📦 **多存储桶支持** — 通过 JSON 配置路由多个 Bucket 到不同的 B2 凭证
- 🌐 **CORS 支持** — 方便浏览器调试和 Web 客户端访问
- 📋 **标准 S3 XML 错误** — 完全兼容 aws-cli、rclone 及所有 S3 SDK
- ⚡ **零出站费用** — Cloudflare ↔ Backblaze B2 流量通过带宽联盟免费
- 🪶 **极简依赖** — 仅使用 [`aws4fetch`](https://github.com/mhart/aws4fetch) 进行请求签名

## 📁 项目结构

```
cloudflare-s3-proxy/
├── src/
│   ├── index.ts       # Worker 入口点 & 请求处理管线
│   ├── types.ts       # TypeScript 类型定义
│   ├── auth.ts        # Access Key 提取与校验
│   ├── parser.ts      # S3 Path-Style URL 解析器
│   ├── errors.ts      # S3 XML 错误响应生成器
│   ├── cors.ts        # CORS 预检与响应头处理
│   └── proxy.ts       # B2 请求重签名与转发引擎
├── wrangler.toml      # Wrangler 部署配置
├── tsconfig.json      # TypeScript 配置
├── package.json       # 项目依赖清单
├── .dev.vars.example  # 本地开发环境变量模板
└── .gitignore
```

## 🔧 工作原理

1. 客户端（如 Rclone）使用**伪造凭证**（自定义 AK + 任意 SK）向 Worker 发起标准 S3 请求
2. Worker 从 `Authorization` Header 中提取 Access Key，校验是否为合法通行证
3. Worker 从 URL 路径解析出 `Bucket Name` 和 `Object Key`
4. Worker 查询 JSON 白名单，匹配该 Bucket 对应的**真实 B2 凭证**
5. Worker 剥离原始伪造签名，使用 `aws4fetch` 以真实凭证重新签名
6. Worker 将签名后的请求转发至 Backblaze B2，并将响应数据流透传回客户端

## 🚀 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) v18+
- [Cloudflare 账号](https://dash.cloudflare.com/sign-up)（免费套餐即可）
- [Backblaze B2](https://www.backblaze.com/b2/cloud-storage.html) 账号及已创建的 S3 兼容存储桶

### 1. 安装依赖

```bash
npm install
```

### 2. 配置本地开发环境

复制环境变量模板并填入真实值：

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`：

```ini
PROXY_ACCESS_KEY=my-secret-proxy-passphrase
BUCKET_CONFIG_JSON={"my-bucket":{"ak":"005xxxxxxxxxxxx000000001","sk":"K005xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","region":"us-west-004"}}
```

| 变量名 | 说明 |
|---|---|
| `PROXY_ACCESS_KEY` | 客户端必须提供的通行证，填入 S3 客户端的 Access Key ID 字段 |
| `BUCKET_CONFIG_JSON` | Bucket 名称到真实 B2 凭证的 JSON 映射表 |

#### `BUCKET_CONFIG_JSON` 格式说明

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

> **如何查找 B2 Region**：进入 Backblaze B2 控制台 → Buckets → 查看 **Endpoint** 列。
> 格式如 `s3.us-west-004.backblazeb2.com`，其中 `us-west-004` 即为 Region 值。

### 3. 启动开发服务器

```bash
npm run dev
```

代理将在 `http://localhost:8787` 启动。

### 4. 使用 cURL 测试

```bash
# 健康检查（根路径）
curl http://localhost:8787/

# 下载对象（带伪造认证头）
curl -H "Authorization: AWS4-HMAC-SHA256 Credential=my-secret-proxy-passphrase/20250101/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=fake" \
  http://localhost:8787/my-bucket/path/to/file.txt
```

## 🌍 部署到 Cloudflare

### 1. 设置 Secrets（加密环境变量）

**切勿**将真实凭证写入 `wrangler.toml`。请使用加密 Secret：

```bash
npx wrangler secret put PROXY_ACCESS_KEY
# 按提示输入你的通行证

npx wrangler secret put BUCKET_CONFIG_JSON
# 按提示粘贴 JSON 字符串
```

### 2. 部署

```bash
npm run deploy
```

部署完成后，代理将运行在 `https://s3-proxy.<你的子域名>.workers.dev`。

### 3.（可选）自定义域名

在 Cloudflare 控制台中为 Worker 添加自定义域名，例如 `s3.yourdomain.com`。

## 🔧 客户端配置示例

### Rclone

在 `~/.config/rclone/rclone.conf` 中添加：

```ini
[b2-proxy]
type = s3
provider = Other
access_key_id = my-secret-proxy-passphrase
secret_access_key = any-fake-value-here
endpoint = https://s3-proxy.your-subdomain.workers.dev
```

> **注意**：`secret_access_key` 可以填任意非空字符串 —— 代理会忽略它，只校验 `access_key_id`。

使用示例：

```bash
# 列出存储桶中的对象
rclone ls b2-proxy:my-bucket

# 通过代理从 B2 下载文件
rclone copy b2-proxy:my-bucket/backups/latest.tar.gz /local/path/

# 同步远程目录到本地
rclone sync b2-proxy:my-bucket/data/ /local/data/ --progress
```

### AWS CLI

```bash
aws configure --profile b2-proxy
# Access Key ID:     my-secret-proxy-passphrase
# Secret Access Key: any-fake-value
# Region:            us-east-1（无所谓，代理会忽略）

# 下载文件
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

## ⚠️ 已知限制

| 限制 | 原因 |
|---|---|
| **仅支持只读**（`GET`/`HEAD`） | Cloudflare Workers 对请求体大小有限制（免费 ~100 MB，付费 ~500 MB），因此故意禁止上传操作 |
| **仅支持 Path-Style 寻址** | Virtual-Hosted-Style（`bucket.endpoint`）需要通配符 DNS，对本场景无必要 |
| **每个 Bucket 单 Region** | 配置中每个 Bucket 映射到一个 B2 Region，这与 B2 的单 Region 模型一致 |

## 📄 开源协议

[MIT](./LICENSE)
