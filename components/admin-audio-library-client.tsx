"use client";

import { useMemo, useState } from "react";
import { BIBLE_BOOKS } from "@/lib/bible/books";

type AdminAction = "save" | "generate" | "upload" | "status";

type AudioAdminResponse = {
  status: string;
  message?: string;
  warning?: string | null;
  inputPath?: string;
  manifestPath?: string;
  expectedFirebasePath?: string;
  estimatedSegments?: number;
  generatedSegments?: string[];
  previewUrl?: string | null;
  canUpload?: boolean;
  hasChapterText?: boolean;
  hasManifest?: boolean;
  hasServiceAccount?: boolean;
  log?: string;
};

const TRANSLATIONS = ["amp", "ampc", "nkjv", "kjv", "esv"] as const;
const DEFAULT_PACK = "John,Romans,Ephesians,Philippians,James";

async function runAdminAction(payload: {
  action: AdminAction;
  translation: string;
  book: string;
  chapter: number;
  text?: string;
}): Promise<AudioAdminResponse> {
  const response = await fetch("/api/admin/audio-library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json() as AudioAdminResponse;
  if (!response.ok) {
    throw new Error(data.message ?? data.log ?? "Audio library action failed.");
  }
  return data;
}

export function AdminAudioLibraryClient(): React.ReactElement {
  const [translation, setTranslation] = useState("amp");
  const [book, setBook] = useState("John");
  const [chapter, setChapter] = useState("3");
  const [chapterText, setChapterText] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [activeStep, setActiveStep] = useState("Ready");
  const [result, setResult] = useState<AudioAdminResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedBook = useMemo(
    () => BIBLE_BOOKS.find((entry) => entry.name === book) ?? BIBLE_BOOKS[0],
    [book]
  );
  const chapterNumber = Math.max(1, Math.min(Number(chapter) || 1, selectedBook.chapters));
  const roughSegments = Math.max(1, Math.ceil(chapterText.trim().length / 3800));
  const expectedInputPath = `local-chapters/${translation}/${book.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${chapterNumber}.txt`;
  const expectedFirebasePath = `bible-audio/${translation}/${book.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${chapterNumber}/manifest.json`;

  const runStep = async (action: AdminAction, label: string, text?: string): Promise<AudioAdminResponse> => {
    setActiveStep(label);
    const response = await runAdminAction({
      action,
      translation,
      book,
      chapter: chapterNumber,
      text
    });
    setResult(response);
    return response;
  };

  const handleSave = async (): Promise<void> => {
    setIsWorking(true);
    setError(null);
    try {
      await runStep("save", "Saving chapter text", chapterText);
      setActiveStep("Chapter text saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed.");
    } finally {
      setIsWorking(false);
    }
  };

  const handleGenerate = async (): Promise<void> => {
    setIsWorking(true);
    setError(null);
    try {
      await runStep("generate", `Generating narration segments for ${book} ${chapterNumber}`);
      setActiveStep("Narration generated. Preview is ready.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Generation failed.");
    } finally {
      setIsWorking(false);
    }
  };

  const handleUpload = async (): Promise<void> => {
    setIsWorking(true);
    setError(null);
    try {
      await runStep("upload", "Uploading audio and updating Firebase library");
      setActiveStep("Firebase library updated");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setIsWorking(false);
    }
  };

  const handleFullWorkflow = async (): Promise<void> => {
    setIsWorking(true);
    setError(null);
    try {
      await runStep("save", "Preparing text", chapterText);
      await runStep("generate", `Generating about ${roughSegments} audio segment${roughSegments === 1 ? "" : "s"}`);
      await runStep("upload", "Uploading audio and updating library.json");
      setActiveStep("Ready in Firebase");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workflow failed.");
    } finally {
      setIsWorking(false);
    }
  };

  const handleFile = async (file: File | null): Promise<void> => {
    if (!file) {
      return;
    }
    setChapterText(await file.text());
  };

  return (
    <main className="admin-audio-page">
      <section className="admin-audio-hero">
        <div>
          <span>Prepared narration library</span>
          <h1>Audio Library Admin</h1>
          <p>Paste chapter text you already have permission to use, generate OpenAI narration once, preview it, then upload it to Firebase Storage for instant playback in the app.</p>
        </div>
        <div className="admin-audio-pack">
          <strong>First library pack</strong>
          <code>{DEFAULT_PACK}</code>
        </div>
      </section>

      <section className="admin-audio-grid">
        <div className="admin-audio-card">
          <h2>Import chapter text</h2>
          <div className="admin-audio-controls">
            <label>
              Translation
              <select value={translation} onChange={(event) => setTranslation(event.target.value)}>
                {TRANSLATIONS.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
              </select>
            </label>
            <label>
              Book
              <select value={book} onChange={(event) => setBook(event.target.value)}>
                {BIBLE_BOOKS.map((entry) => <option key={entry.code} value={entry.name}>{entry.name}</option>)}
              </select>
            </label>
            <label>
              Chapter
              <select value={chapter} onChange={(event) => setChapter(event.target.value)}>
                {Array.from({ length: selectedBook.chapters }, (_, index) => String(index + 1)).map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="admin-audio-file">
            Optional .txt upload
            <input type="file" accept=".txt,text/plain" onChange={(event) => void handleFile(event.target.files?.[0] ?? null)} />
          </label>

          <label>
            Chapter text
            <textarea
              value={chapterText}
              onChange={(event) => setChapterText(event.target.value)}
              placeholder="Paste AMP John 3 text here. The app will clean verse numbers and cross-reference notes only for narration generation."
            />
          </label>

          <div className="admin-audio-safeguards">
            <span>{chapterText.trim().length.toLocaleString()} characters</span>
            <span>Estimated {roughSegments} segment{roughSegments === 1 ? "" : "s"}</span>
            <span>{expectedInputPath}</span>
          </div>
        </div>

        <aside className="admin-audio-card">
          <h2>Generate and publish</h2>
          <ol className="admin-audio-steps">
            {["preparing text", "generating segments", "previewing audio", "uploading audio", "updating library"].map((step) => (
              <li key={step} className={activeStep.toLowerCase().includes(step.split(" ")[0]) ? "is-active" : ""}>{step}</li>
            ))}
          </ol>

          <div className="admin-audio-actions">
            <button type="button" onClick={handleSave} disabled={isWorking || chapterText.trim().length < 20}>Save chapter text</button>
            <button type="button" onClick={handleGenerate} disabled={isWorking}>Generate narration</button>
            <button type="button" onClick={handleUpload} disabled={isWorking || !result?.canUpload}>Upload to Firebase</button>
            <button type="button" className="is-primary" onClick={handleFullWorkflow} disabled={isWorking || chapterText.trim().length < 20}>Run full workflow</button>
          </div>

          <div className="admin-audio-status">
            <strong>{isWorking ? "Working" : activeStep}</strong>
            <p>Firebase target: <code>{result?.expectedFirebasePath ?? expectedFirebasePath}</code></p>
            {result?.warning ? <p className="admin-audio-warning">{result.warning}</p> : null}
            {error ? <p className="admin-audio-error">{error}</p> : null}
          </div>

          {result?.previewUrl ? (
            <div className="admin-audio-preview">
              <strong>Preview before upload</strong>
              <audio controls src={result.previewUrl} />
            </div>
          ) : null}

          {result?.log ? <pre className="admin-audio-log">{result.log}</pre> : null}
        </aside>
      </section>
    </main>
  );
}
