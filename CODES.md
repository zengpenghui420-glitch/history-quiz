# 限次验证码说明

- 验证码格式：`LS` + 4 位（如 `LSAB23`），每个最多使用 **3 次**（跨设备共享计数）
- 访问码在同一浏览器标签页会话内解锁后，「再测一次」不重复扣次
- 支持链接自动填码：`https://zengpenghui420-glitch.github.io/history-quiz/?code=LSXXXX`
- 已发出的码先 `POST /redeem`（quiz 键 `history`）。vault 明确用尽则不再落到 Mantle；vault 没有这枚码时才回退本测验的 Mantle 集合 `hq/`，剩余次数是真实计数
- 订单号不是访问码，不会写入 `hq/`，也不会走订单核销接口。只接受 `P` + 18 位；重复块、逐位 ±1 的序列和 19 位都提示「订单号格式不对」，并且不会开始测验
- 「还可以测 N 次」按订单号记在 `localStorage`（键 `history_quiz_order_uses`）。刷新、继续这一次、查看上次结果不改这次显示；再测一次才往后记。记到 3 次之后仍可进入，提示为「验证成功」
- 后端：MantleDB（namespace `catquiz-zph420-codes`，集合 `hq/`，与猫咪测试 `c/`、八字 `bz/` 互不通用）
- 继续造码：

```bash
MANTLE_CREDS=/path/to/mantle.json ./tools/mint.sh 10
```
