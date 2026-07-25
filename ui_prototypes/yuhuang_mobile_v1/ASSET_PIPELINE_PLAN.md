# 多角色原创素材管线计划

## 1. 当前阶段

本项目当前是“基于传统文化 IP 的老龄化多模态陪伴系统”手机端 Web UI 静态原型。系统后续将支持多位传统文化陪伴角色，但当前尚未拥有可接入的正式原创主视觉素材。

本阶段只统一目录、命名、生成要求、验收方式和未来接入约定：

- 不生成图片或视频；
- 不下载网络素材；
- 不接入不存在的图片或视频路径；
- 不创建伪造的素材文件；
- 不改变当前 HTML/CSS 页面布局；
- 不改变 Realtime 核心逻辑。

## 2. 首批角色与目录标识

首批至少支持以下 8 个角色。目录标识统一使用英文小写，不使用空格、中文、连字符或大小写混排。

| 角色 | 目录标识 | 目录 |
| --- | --- | --- |
| 玉皇大帝 | `yuhuang` | `assets/characters/yuhuang/` |
| 孙悟空 | `sunwukong` | `assets/characters/sunwukong/` |
| 观音菩萨 | `guanyin` | `assets/characters/guanyin/` |
| 太上老君 | `taishanglaojun` | `assets/characters/taishanglaojun/` |
| 财神爷 | `caishen` | `assets/characters/caishen/` |
| 猪八戒 | `zhubajie` | `assets/characters/zhubajie/` |
| 唐僧 | `tangseng` | `assets/characters/tangseng/` |
| 沙悟净 | `shawujing` | `assets/characters/shawujing/` |

## 3. 统一目录结构

```text
ui_prototypes/yuhuang_mobile_v1/
├─ index.html
├─ ui.css
├─ assets/
│  └─ characters/
│     ├─ yuhuang/
│     │  └─ .gitkeep
│     ├─ sunwukong/
│     │  └─ .gitkeep
│     ├─ guanyin/
│     │  └─ .gitkeep
│     ├─ taishanglaojun/
│     │  └─ .gitkeep
│     ├─ caishen/
│     │  └─ .gitkeep
│     ├─ zhubajie/
│     │  └─ .gitkeep
│     ├─ tangseng/
│     │  └─ .gitkeep
│     └─ shawujing/
│        └─ .gitkeep
├─ ASSET_PIPELINE_PLAN.md
└─ CHARACTER_ASSET_SPEC.md
```

当前每个角色目录只放 `.gitkeep`。在正式素材通过验收之前，不创建假的 `scene.webp`、`scene.webm`、`avatar.webp` 或 `card.webp`。

## 4. 推荐素材命名与正式上线要求

每个角色目录未来统一使用以下文件名：

| 文件名 | 正式上线是否必需 | 用途 |
| --- | --- | --- |
| `scene.webm` | 是 | 手机首页默认播放的低速、无音频轨道、循环动态主视觉；网页接入时仍必须设置 `muted` |
| `scene.webp` | 是 | 视频 poster、首帧占位、加载失败、弱网、省流量和减少动态模式的静态兜底图 |
| `avatar.webp` | 是 | 角色选择面板头像 |
| `card.webp` | 否 | 角色介绍或角色选择卡片封面 |
| `notes.md` | 建议 | 记录版本、来源、生成提示词、视觉要点、权利信息和验收结论 |

示例路径仅表示未来命名，不代表文件当前存在：

```text
assets/characters/yuhuang/scene.webp
assets/characters/yuhuang/scene.webm
assets/characters/yuhuang/avatar.webp
assets/characters/yuhuang/card.webp
```

### 4.1 动态优先总原则

正式产品首页以 `scene.webm` 作为默认动态主视觉，`scene.webp` 必须同时存在并承担所有静态兜底场景。页面运行时的展示优先级统一为：

```text
scene.webm → scene.webp → 页面 CSS 降级背景
```

- `scene.webm`：正常默认模式下的正式首页主视觉；
- `scene.webp`：视频 poster、首帧占位、视频加载失败、弱网模式、省流量模式、系统减少动态效果、用户主动选择静态模式以及设备不支持动态播放时使用；
- 页面 CSS 降级背景：两个正式素材均无法展示时的最后保护层。

`scene.webm` 不是纯附加效果。首批 8 个角色均按动态主视觉完成标准验收。

### 4.2 开发验证阶段与正式上线阶段

开发验证阶段允许先制作 `scene.webp`，用于锁定角色造型、竖屏构图、安全区、色彩和控件遮挡关系，此时页面可以暂时只显示静态图。

正式角色上线阶段必须同时完成 `scene.webp` 和 `scene.webm`：

- 只有静态图、没有动态场景的角色，不算完成正式主视觉验收；
- 未完成动态场景的角色可以继续作为静态开发预览，或在角色选择页标记为“尚待迎请”；
- 不得把静态开发预览误称为正式完成版本；
- 制作流程先定静态构图，不等于正式页面运行时优先使用静态图。

## 5. 素材统一基线

首批 8 个角色必须统一以下内容：

1. 画风：统一为中式古典、东方神话、写实插画质感，不混用照片写实、二次元、国漫或影视剧截图；
2. 手机竖屏构图：主视觉统一使用 9:16 竖屏构图；
3. 安全区：统一保留顶部控件区、左右入口区和底部通话操作区；
4. 光影质感：统一使用低饱和综合色彩、柔和暖光、克制高光和有层次的云雾空间；
5. 场景关系：角色与背景一体化，不使用孤立透明抠图或棋盘格背景；
6. 头像规格：统一为 1:1、同等头肩比例、同等背景复杂度和同等光线方向；
7. 文件命名：所有角色使用相同的 `scene`、`avatar`、`card` 命名；
8. 动态规范：正式角色必须具备低速动态主视觉；`scene.webm` 文件本身不得包含任何音频轨道，网页接入时仍必须设置 `muted`；不允许人物无意义循环动作；
9. 版权边界：不得复制影视画面、具体演员面貌、水印素材或来源不明的商业图。

详细生成和构图要求以 `CHARACTER_ASSET_SPEC.md` 为准。

## 6. 制作验收顺序与正式页面加载优先级

### 6.1 制作验收顺序

1. `scene.webp`：先锁定角色造型、构图、安全区和场景色彩；
2. `scene.webm`：基于已经验收的静态构图制作低速循环动态场景；
3. `scene.webp` 与 `scene.webm` 联合验收：检查首末帧、人物位置、亮度、色彩和 UI 遮挡是否一致；
4. `avatar.webp`：按统一头像规格制作角色选择头像；
5. `card.webp`：按角色介绍或运营展示需要补充。

`notes.md` 建议随素材制作持续记录版本、来源、生成提示词、权利信息和验收结论。

### 6.2 正式页面加载优先级

1. `scene.webm`；
2. `scene.webp`；
3. 页面 CSS 降级背景。

制作时先验证静态构图，不等于页面运行时优先使用静态图。不得为了赶进度跳过 `scene.webp`，也不得把缺少 `scene.webm` 的静态预览当作正式完成版本。

## 7. 素材进入工程的流程

1. 将候选原创素材放入对应角色目录；
2. 核对目录标识和文件名，不在页面中硬编码临时文件名；
3. 检查尺寸、比例、格式、透明背景、水印、字幕和边框；
4. 分别在 360×800、390×844、430×932 下检查静态构图、安全区和人物裁切；
5. 检查角色脸部、冠饰、肩部、双手是否与 UI 控件冲突；
6. 基于通过验收的 `scene.webp` 制作同构图的 `scene.webm`；
7. 联合检查动静态素材的首末帧、人物位置、亮度、色彩、静音循环和 UI 遮挡；
8. 检查弱网、省流量、视频失败和减少动态模式能否回退到 `scene.webp`；
9. 检查所有首批角色是否保持统一画风、构图、光影、动态强度和头像尺度；
10. 确认版权与商业使用范围后，才进入正式页面接入。

## 8. 多角色切换的未来思路

未来角色切换只替换角色数据和素材，不重做首页 UI 框架：

- 顶部名称切换为对应角色；
- 首页正常默认模式切换到该目录下的 `scene.webm`；
- 同步切换同目录下的 `scene.webp`，作为 poster 和静态兜底；
- 角色选择面板使用该目录下的 `avatar.webp`；
- 角色介绍需要封面时使用 `card.webp`；
- 当前仙伴、余时、充值、辅助入口、状态字幕、通话按钮和费用提示保持统一；
- Realtime 核心逻辑不因视觉角色切换而改变。

首批多角色扩展范围包括：玉皇大帝、孙悟空、观音菩萨、太上老君、财神爷、猪八戒、唐僧、沙悟净。后续新增角色时，继续新增一个英文小写目录并复用同一套文件名和验收流程。

未来页面接入结构可以参考：

```html
<video
  autoplay
  muted
  loop
  playsinline
  poster="./assets/characters/yuhuang/scene.webp">
  <source
    src="./assets/characters/yuhuang/scene.webm"
    type="video/webm">
</video>
```

接入时必须保证视频位于 UI 控件后方、设置 `pointer-events: none`、不显示播放器控制栏；`scene.webm` 文件本身不得包含任何音频轨道，网页接入时仍必须设置 `muted`；角色切换时同时切换 `scene.webm` 与 `scene.webp`。减少动态模式隐藏视频并显示静态图。

正常默认模式播放低速动态主视觉。未来可以增加“动态场景 / 静态场景”的用户主动选择，但当前静态原型阶段不增加设置按钮或 JavaScript。

## 9. 注意事项

- 不使用影视截图、电视剧画面或来源不明的剧照；
- 不直接模仿具体演员的脸、妆容、服装细节或标志性表演画面；
- 不使用棋盘格、假透明背景、残留水印、字幕或 UI；
- 不让部分角色写实、部分角色二次元、部分角色国漫、部分角色照片化；
- 不以缩小人物的方式规避安全区冲突；
- 素材的原创性、商业可用性、授权范围和生成平台条款需要在正式上线前再次确认。
