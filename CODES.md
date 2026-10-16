# 限次验证码说明

- 验证码格式：`LS` + 4 位（如 `LSAB23`），每个最多使用 **3 次**（跨设备共享计数）
- 同一浏览器标签页会话内解锁后，「再测一次」不重复扣次
- 支持链接自动填码：`https://zengpenghui420-glitch.github.io/history-quiz/?code=LSXXXX`
- 后端：MantleDB（namespace `catquiz-zph420-codes`，集合 `hq/`，与猫咪测试 `c/`、八字 `bz/` 互不通用）
- 继续造码：

```bash
MANTLE_CREDS=/path/to/mantle.json ./tools/mint.sh 10
```
