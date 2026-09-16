# Chinese copy style — BPM Badminton (zh-CN)

> Written 2026-09-15, when all 1,672 zh-CN strings were rewritten in one pass
> (Grant: "all the Chinese you have sounds so AI or formal but awkwardly weird").
> Follow it for any new Chinese string, or the app drifts back one key at a time.

The app is a weekly badminton club run by friends. The English voice is plain
and warm: "built for friends, not a finance team". The current Chinese reads
like machine translation — stiff, over-formal, sometimes literally English word
order. Grant (a native speaker) asked for **clean and neutral**: natural
everyday Chinese, the way a well-made consumer app sounds. NOT chatty, NOT
formal-corporate.

## Reference apps (Grant asked for one)

Write as **Keep**（健身 app）writes: short, plain, verb-first, no marketing
gloss, no 请您. Its register is exactly "clean and neutral".

For anything about booking a slot — report/cancel/waitlist — follow the way a
**微信小程序活动报名** flow reads: 立即报名 / 已报名 / 取消报名 / 候补中,
never a translated "register for the session".

Concrete habits to copy from those apps:

- Tab and section names are 2–4 characters: 首页 · 报名 · 数据 · 我的.
- Buttons are verbs, no 请: 保存 · 重试 · 去设置 · 立即报名.
- Failures are flat statements: 加载失败 · 网络异常，请稍后重试 (keep 请 only
  where the English says please).
- Empty states are one line: 还没有记录.
- Personal things use 我的 (我的球拍 · 我的数据), not 你的.
- Counts read as 已报名 8/12, not "12 人中的 8 人".

## Voice

- **你**, never 您. No 请 unless the English says "please".
- No particles for flavour (吧/啦/呢) — that is the chattier register Grant did
  not pick. 了 is fine where grammar wants it.
- Short. Chinese UI copy is usually shorter than English; do not pad.
- Say what happened, not what the system did: 没加载出来 / 加载失败, not
  "系统未能读取".
- Drop pronouns and 的 where a native speaker would: 我的球拍 → 球拍 when the
  context is already "yours".
- Keep the English sentence's MEANING, not its grammar. Rewrite freely.

## Terminology (use these consistently)

| English | Chinese |
|---|---|
| session (a night of badminton) | 场次 (a specific one: 本周场次) |
| sign up / signed up | 报名 / 已报名 |
| waitlist | 候补 |
| account | 账号 (never 账户) |
| Profile tab | 「我的」 |
| Sign-Ups tab | 「报名」 |
| Stats tab | 「数据」 |
| Home tab | 「首页」 (the convention Keep and WeChat mini programs use) |
| admin / organiser | 管理员 |
| PIN | PIN (keep English) |
| Google / Apple / Email | keep as-is; 邮箱 for email address |
| stringing job | 穿线单 (never 工单) |
| racket | 球拍 · strings 线 · tension 磅数 |
| shuttle / bird | 羽毛球 · tube 筒 |
| kudos | 点赞 |
| check-in (skill) | 自评 |
| e-transfer | 转账 |
| court | 场地 |
| level / rating | 等级 / 评分 |

## Hard rules (a break here ships a bug)

1. **Keep every placeholder EXACTLY**: `{name}`, `{count}`, `{date}`, `{total}`.
   Same set, same spelling. Never translate a placeholder name.
2. **Keep ICU plural/select syntax intact**: `{weeks, plural, one {...} other {...}}`.
   Chinese has no plural distinction — write the same text in every branch, and
   keep `#` where the English uses it.
3. **Keep rich-text tags**: `<b>…</b>`, `<link>…</link>` — same tags, same order.
4. **Keep Markdown** (`**bold**`, `• `) and line breaks (`\n`) as they are.
5. Keep product names in English: BPM, Google, Apple, PIN, Cosmos.
6. Numbers, dates and money formats stay as the placeholders give them.
7. If a string is ALREADY natural, leave it unchanged — return it as-is.

## Examples (the bar)

| Now | Better |
|---|---|
| 你的账户 | 我的账号 |
| 没能读取本周的场次。 | 本周场次加载失败。 |
| 已经用邮箱或 Google？在个人页登录。 | 用过邮箱或 Google？去「我的」登录。 |
| 没能读取你的工单。 | 穿线单加载失败。 |
| 设置 PIN，方便下次登录 | 设置 PIN，下次可自己登录 |
| 目前 PIN 码是你唯一的登录方式。 | 目前只能用 PIN 登录。 |
