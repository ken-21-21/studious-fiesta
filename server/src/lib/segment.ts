// Structural segmentation of a textbook into lessons and typed sections.
// Tuned for clean digital text/PDF with recognizable headers (Genki-style:
// "Lesson 3" / "第3課", and section labels like Vocabulary / Grammar / Culture).

export type SectionType =
  | "vocabulary"
  | "grammar"
  | "dialogue"
  | "culture"
  | "reading"
  | "practice"
  | "content";

export interface Section {
  type: SectionType;
  title: string;
  lines: string[];
}

export interface Lesson {
  number: number | null;
  title: string;
  sections: Section[];
}

const LESSON_PATTERNS: RegExp[] = [
  /^\s*(?:lesson|unit|chapter)\s+(\d+)\b[:.\s]*(.*)$/i,
  /^\s*第\s*(\d+)\s*課[:：\s]*(.*)$/,
  /^\s*だい\s*(\d+)\s*か[:：\s]*(.*)$/,
  /^\s*L\s*(\d+)\b[:.\s]*(.*)$/,
];

// Section header → canonical type. Matched against a whole (short) line.
//
// Note: \b is a transition between \w and non-\w, and JS regex's \w is
// ASCII-only — it never matches CJK characters. A trailing \b after a
// Japanese alternative (e.g. 会話\b) is therefore a no-op that can never
// match, since there's no \w/non-\w transition to find at all. We use a
// boundary that works for both ASCII and CJK keywords: end-of-string, or
// followed by whitespace/punctuation (not a further word character).
const SECTION_KEYWORDS: { type: SectionType; re: RegExp }[] = [
  { type: "vocabulary", re: /^\s*(vocabulary|vocab|word\s*list|単語|たんご|語彙|ごい)(?![\p{L}\p{N}])/iu },
  { type: "grammar", re: /^\s*(grammar|grammar\s*notes?|文法|ぶんぽう)(?![\p{L}\p{N}])/iu },
  { type: "dialogue", re: /^\s*(dialogue|dialog|conversation|会話|かいわ)(?![\p{L}\p{N}])/iu },
  { type: "culture", re: /^\s*(culture\s*notes?|culture|文化|ぶんか|culture\s*&)(?![\p{L}\p{N}])/iu },
  { type: "reading", re: /^\s*(reading|reading\s*(?:and|&)\s*writing|読み物|よみもの|読解)(?![\p{L}\p{N}])/iu },
  { type: "practice", re: /^\s*(practice|exercises?|drills?|練習|れんしゅう)(?![\p{L}\p{N}])/iu },
];

function matchLesson(line: string): { number: number; title: string } | null {
  // Avoid treating long prose lines that merely contain "lesson" as headers.
  if (line.trim().length > 60) return null;
  for (const re of LESSON_PATTERNS) {
    const m = line.match(re);
    if (m) return { number: Number(m[1]), title: m[2]?.trim() || "" };
  }
  return null;
}

function matchSection(line: string): { type: SectionType; title: string } | null {
  if (line.trim().length > 50) return null;
  for (const { type, re } of SECTION_KEYWORDS) {
    if (re.test(line)) return { type, title: line.trim() };
  }
  return null;
}

/**
 * Parse raw text into lessons → sections. Falls back gracefully:
 *  - no lesson headers → a single implicit lesson holding everything
 *  - no section headers within a lesson → one "content" section
 */
export function segmentTextbook(text: string): Lesson[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const lessons: Lesson[] = [];

  let currentLesson: Lesson | null = null;
  let currentSection: Section | null = null;

  const startLesson = (number: number | null, title: string) => {
    currentLesson = { number, title, sections: [] };
    lessons.push(currentLesson);
    currentSection = null;
  };
  const startSection = (type: SectionType, title: string) => {
    if (!currentLesson) startLesson(null, "");
    currentSection = { type, title, lines: [] };
    currentLesson!.sections.push(currentSection);
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    const lessonHit = matchLesson(line);
    if (lessonHit) {
      startLesson(lessonHit.number, lessonHit.title);
      continue;
    }

    const sectionHit = matchSection(line);
    if (sectionHit) {
      startSection(sectionHit.type, sectionHit.title);
      continue;
    }

    if (line.trim() === "") continue;

    if (!currentSection) startSection("content", "");
    currentSection!.lines.push(line.trim());
  }

  // No structure detected at all → wrap the whole document as one lesson/section.
  if (lessons.length === 0) {
    return [
      {
        number: null,
        title: "",
        sections: [{ type: "content", title: "", lines: lines.map((l) => l.trim()).filter(Boolean) }],
      },
    ];
  }

  return lessons;
}
