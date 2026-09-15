# face-api.js 模型权重

前端人脸检测/识别依赖 face-api.js 的预训练权重。请将以下文件下载到本目录（`frontend/public/models/`）：

- `tiny_face_detector_model-weights_manifest.json`
- `tiny_face_detector_model-shard1`
- `face_landmark_68_model-weights_manifest.json`
- `face_landmark_68_model-shard1`
- `face_recognition_model-weights_manifest.json`
- `face_recognition_model-shard1`
- `face_recognition_model-shard2`

下载方式（任选其一）：

```bash
# 方式 A：从 face-api.js 仓库复制
git clone --depth 1 https://github.com/justadudewhohacks/face-api.js.git
cp face-api.js/weights/* .

# 方式 B：npm 包内自带（安装 face-api.js 后复制）
cp node_modules/face-api.js/weights/* .
```

放置完成后，应用启动时会从 `/models` 自动加载，无需额外配置。
