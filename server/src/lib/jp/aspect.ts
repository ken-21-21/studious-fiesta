// Lexical aspect classes for the ている progressive-vs-resultant distinction.
// This is lexical, not morphological: 読む+ている = progressive ("is reading"),
// 開く+ている = resultant state ("is open"). When a verb is not classified we
// refuse to guess and mark the analysis ambiguous.

// Change-of-state / punctual verbs → ている describes the resulting STATE.
const RESULTATIVE = new Set([
  "開く", "開ける", "閉まる", "閉じる", "閉める", "つく", "点く", "消える", "始まる", "終わる",
  "結婚する", "死ぬ", "来る", "行く", "着く", "到着する", "届く", "起きる", "寝る", "立つ",
  "座る", "止まる", "割れる", "壊れる", "落ちる", "入る", "出る", "乗る", "降りる", "なる",
  "知る", "覚える", "忘れる", "太る", "やせる", "疲れる", "腐る", "乾く", "濡れる", "倒れる",
  "見つかる", "決まる", "変わる", "残る", "残す", "並ぶ",
]);

// Activity / durative verbs → ている describes an ONGOING action.
const DURATIVE = new Set([
  "読む", "書く", "食べる", "飲む", "話す", "見る", "聞く", "走る", "歩く", "泳ぐ",
  "勉強する", "働く", "遊ぶ", "待つ", "作る", "使う", "歌う", "踊る", "降る", "泣く",
  "笑う", "考える", "探す", "飛ぶ", "押す", "引く", "運ぶ", "料理する", "運転する",
  "話し合う", "練習する", "見せる", "教える", "習う", "describe",
]);

// Verbs that are genuinely ambiguous in ている (both readings common).
const BOTH = new Set(["着る", "履く", "かぶる", "持つ", "住む"]);

export type AspectClass = "resultative" | "durative" | "both" | "unknown";

export function aspectOf(verbBase: string): AspectClass {
  if (BOTH.has(verbBase)) return "both";
  if (RESULTATIVE.has(verbBase)) return "resultative";
  if (DURATIVE.has(verbBase)) return "durative";
  return "unknown";
}
