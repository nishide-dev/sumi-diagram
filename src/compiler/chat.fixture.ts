/** Shared bilingual conversation for compiler, geometry and export regressions. */
export const chatSource = `version: 1
figure:
  id: conversation
  theme: paper
  profile: paper-single
  layout:
    arrange: { stack: { items: [conversation] } }
groups:
  - id: conversation
    variant: plain
    arrange:
      chat:
        width: 72mm
        maxWidth: 0.7
        speakers:
          friend: { side: left, avatar: avatar }
          me: { side: right, tone: green, variant: filled }
        items:
          - divider: 今日
          - { node: m1, from: friend, meta: "23:10" }
          - { node: m2, from: friend, meta: "23:11" }
          - { node: m3, from: me, meta: [既読, "23:12"] }
          - { node: m4, from: me, meta: [Read, "23:13"] }
          - { node: m5, from: friend, meta: "23:14" }
nodes:
  - { id: avatar, component: circle, variant: filled, tone: gray, label: Y, props: { width: 16pt, height: 16pt } }
  - { id: m1, component: bubble, label: 次いつ遊ぶ？？ }
  - { id: m2, component: bubble, label: "日本語の長いメッセージも最大幅で折り返して、吹き出しの中で左揃えになります。" }
  - { id: m3, component: bubble, label: "This English message wraps at word boundaries within the maximum bubble width." }
  - { id: m4, component: bubble, label: Sure! }
  - { id: m5, component: bubble, label: おけ！ }
`;
