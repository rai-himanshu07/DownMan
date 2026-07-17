import { useEffect, useState } from "react";
import { api, DownloadProfile, PolicyValidation, Queue } from "../lib/api";
import { I } from "./icons";

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function copyProfile(source: DownloadProfile): DownloadProfile {
  const name = `${source.name} copy`;
  return {
    ...source,
    id: `${slug(name) || "profile"}-${Date.now().toString(36)}`,
    name,
    description: source.description,
    builtin: false,
    subtitleLanguages: [...source.subtitleLanguages],
    sponsorblockCategories: [...source.sponsorblockCategories],
    headers: [...source.headers],
    createdAt: 0,
    updatedAt: 0,
  };
}

export default function ProfileSettings({ queues }: { queues: Queue[] }) {
  const [profiles, setProfiles] = useState<DownloadProfile[]>([]);
  const [activeId, setActiveId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<DownloadProfile | null>(null);
  const [message, setMessage] = useState("");
  const [validation, setValidation] = useState<PolicyValidation | null>(null);

  function load(preferId?: string) {
    Promise.all([api.listDownloadProfiles(), api.activeDownloadProfile()])
      .then(([items, active]) => {
        setProfiles(items);
        setActiveId(active.id);
        const selected = items.find((item) => item.id === (preferId || selectedId)) || items.find((item) => item.id === active.id) || items[0];
        if (selected) {
          setSelectedId(selected.id);
          setDraft({ ...selected });
        }
      })
      .catch((error) => setMessage(String(error)));
  }

  useEffect(() => { load(); }, []);

  function select(id: string) {
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    setSelectedId(id);
    setDraft({ ...profile, subtitleLanguages: [...profile.subtitleLanguages], sponsorblockCategories: [...profile.sponsorblockCategories], headers: [...profile.headers] });
    setMessage("");
  }

  function patch(values: Partial<DownloadProfile>) {
    setDraft((profile) => profile ? { ...profile, ...values } : profile);
    setValidation(null);
  }

  async function activate() {
    if (!draft) return;
    try {
      const active = await api.setActiveDownloadProfile(draft.id);
      setActiveId(active.id);
      setMessage(`${active.name} is now the default`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function save() {
    if (!draft || draft.builtin) return;
    try {
      const candidate = { ...draft, id: slug(draft.id) };
      const result = await api.validateMediaPolicy(candidate);
      setValidation(result);
      if (!result.valid) {
        setMessage("Fix the highlighted policy errors before saving");
        return;
      }
      const saved = await api.saveDownloadProfile(candidate);
      setMessage("Profile saved");
      load(saved.id);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function remove() {
    if (!draft || draft.builtin) return;
    try {
      await api.deleteDownloadProfile(draft.id);
      setMessage("Profile deleted");
      load();
    } catch (error) {
      setMessage(String(error));
    }
  }

  if (!draft) return <div className="card p-5 text-sm text-slate-500">Loading download profiles...</div>;

  const editable = !draft.builtin;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[250px_minmax(0,1fr)] gap-4">
      <div className="card p-3 self-start">
        <div className="flex items-center justify-between px-2 pb-2">
          <h3 className="font-semibold">Profiles</h3>
          <button className="btn-ghost !p-1.5" title="Duplicate selected profile" onClick={() => {
            const next = copyProfile(draft);
            setProfiles((items) => [...items, next]);
            setSelectedId(next.id);
            setDraft(next);
            setMessage("Edit the copy, then save it");
          }}><I.Plus className="w-4 h-4" /></button>
        </div>
        <div className="space-y-1">
          {profiles.map((profile) => (
            <button key={profile.id} aria-current={activeId === profile.id ? "true" : undefined} onClick={() => select(profile.id)} className={`w-full text-left px-3 py-2 rounded-sm border ${selectedId === profile.id ? "border-aurora-400/50 bg-aurora-400/10" : "border-transparent hover:bg-white/5"}`}>
              <div className="flex items-center gap-2 text-sm text-slate-200">
                <span className={`w-1.5 h-1.5 rounded-full ${activeId === profile.id ? "bg-lime-400" : "bg-slate-700"}`} />
                <span className="truncate">{profile.name}</span>
              </div>
              <div className="text-[10px] uppercase font-mono text-slate-600 mt-0.5">{profile.builtin ? "Built-in" : "Custom"}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4 min-w-0">
        <div className="card p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <input value={draft.name} disabled={!editable} onChange={(event) => patch({ name: event.target.value })} className="w-full bg-transparent text-lg font-semibold disabled:text-slate-200 focus:outline-none" />
              <input value={draft.description} disabled={!editable} onChange={(event) => patch({ description: event.target.value })} placeholder="What this profile is for" className="mt-1 w-full bg-transparent text-sm text-slate-500 disabled:text-slate-500 focus:outline-none" />
            </div>
            <button className="btn-primary shrink-0" disabled={activeId === draft.id} onClick={activate}>{activeId === draft.id ? "Active" : "Use by default"}</button>
          </div>
          {editable && <Field label="Profile ID"><input value={draft.id} onChange={(event) => patch({ id: slug(event.target.value) })} className="control font-mono" /></Field>}
        </div>

        <div className="card p-5 space-y-4">
          <h3 className="font-semibold">Media policy</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label="Mode" value={draft.mediaMode} disabled={!editable} onChange={(value) => patch({ mediaMode: value as DownloadProfile["mediaMode"] })} options={[["video-audio", "Video + audio"], ["audio-only", "Audio only"], ["subtitles-only", "Subtitles only"]]} />
            <Select label="Quality cap" value={draft.quality} disabled={!editable} onChange={(quality) => patch({ quality })} options={[["best", "Best available"], ["quality:2160", "Up to 2160p"], ["quality:1440", "Up to 1440p"], ["quality:1080", "Up to 1080p"], ["quality:720", "Up to 720p"], ["quality:480", "Up to 480p"], ["quality:360", "Up to 360p"]]} />
            <Select label="Container" value={draft.container} disabled={!editable} onChange={(container) => patch({ container })} options={["mp4", "mkv", "webm", "mov"].map((value) => [value, value.toUpperCase()])} />
            <Select label="Video codec" value={draft.videoCodec} disabled={!editable} onChange={(videoCodec) => patch({ videoCodec })} options={[["best", "Best available"], ["h264", "H.264"], ["h265", "H.265"], ["vp9", "VP9"], ["av1", "AV1"]]} />
            <Select label="Preferred FPS" value={draft.preferredFps} disabled={!editable} onChange={(preferredFps) => patch({ preferredFps })} options={[["original", "Original"], ["60", "Up to 60"], ["30", "Up to 30"], ["24", "Up to 24"]]} />
            <Select label="Audio format" value={draft.audioFormat} disabled={!editable} onChange={(audioFormat) => patch({ audioFormat })} options={[["best", "Best available"], ["mp3", "MP3"], ["opus", "Opus"], ["m4a", "M4A"], ["flac", "FLAC"], ["wav", "WAV"]]} />
            <Field label="Audio bitrate (kbps)"><input disabled={!editable} value={draft.audioBitrate} onChange={(event) => patch({ audioBitrate: event.target.value })} placeholder="best or 192" className="control" /></Field>
            <Select label="Live streams" value={draft.livePolicy} disabled={!editable} onChange={(livePolicy) => patch({ livePolicy: livePolicy as DownloadProfile["livePolicy"] })} options={[["from-now", "Download from now"], ["from-start", "Download from start"], ["skip", "Skip live streams"]]} />
            <Field label="Clip start"><input disabled={!editable} value={draft.clipStart} onChange={(event) => patch({ clipStart: event.target.value })} placeholder="Seconds or HH:MM:SS" className="control font-mono" /></Field>
            <Field label="Clip end"><input disabled={!editable} value={draft.clipEnd} onChange={(event) => patch({ clipEnd: event.target.value })} placeholder="Seconds or HH:MM:SS" className="control font-mono" /></Field>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h3 className="font-semibold">Subtitles and post-processing</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label="Subtitles" value={draft.subtitleMode} disabled={!editable} onChange={(subtitleMode) => patch({ subtitleMode: subtitleMode as DownloadProfile["subtitleMode"] })} options={[["off", "Off"], ["sidecar", "Sidecar files"], ["embed", "Embed in media"]]} />
            <Select label="Subtitle format" value={draft.subtitleFormat} disabled={!editable} onChange={(subtitleFormat) => patch({ subtitleFormat })} options={["srt", "vtt", "ass", "lrc"].map((value) => [value, value.toUpperCase()])} />
            <Field label="Subtitle languages"><input disabled={!editable} value={draft.subtitleLanguages.join(", ")} onChange={(event) => patch({ subtitleLanguages: split(event.target.value) })} placeholder="en, hi, fr" className="control" /></Field>
            <Select label="SponsorBlock" value={draft.sponsorblockMode} disabled={!editable} onChange={(sponsorblockMode) => patch({ sponsorblockMode: sponsorblockMode as DownloadProfile["sponsorblockMode"] })} options={[["off", "Off"], ["mark", "Mark chapters"], ["remove", "Remove segments"]]} />
            <Field label="SponsorBlock categories"><input disabled={!editable} value={draft.sponsorblockCategories.join(", ")} onChange={(event) => patch({ sponsorblockCategories: split(event.target.value) })} placeholder="sponsor, intro, outro" className="control" /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Check label="Embed metadata" checked={draft.embedMetadata} disabled={!editable} onChange={(embedMetadata) => patch({ embedMetadata })} />
            <Check label="Embed thumbnail" checked={draft.embedThumbnail} disabled={!editable} onChange={(embedThumbnail) => patch({ embedThumbnail })} />
            <Check label="Embed chapters" checked={draft.embedChapters} disabled={!editable} onChange={(embedChapters) => patch({ embedChapters })} />
            <Check label="Write description" checked={draft.writeDescription} disabled={!editable} onChange={(writeDescription) => patch({ writeDescription })} />
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h3 className="font-semibold">Output and network</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Output folder"><input disabled={!editable} value={draft.outputDir} onChange={(event) => patch({ outputDir: event.target.value })} placeholder="Use DownMan default" className="control font-mono" /></Field>
            <Field label="Subfolder"><input disabled={!editable} value={draft.subfolder} onChange={(event) => patch({ subfolder: event.target.value })} placeholder="Optional subfolder" className="control font-mono" /></Field>
            <Field label="Filename template"><input disabled={!editable} value={draft.filenameTemplate} onChange={(event) => patch({ filenameTemplate: event.target.value })} placeholder="%(title)s [%(id)s]" className="control font-mono" /></Field>
            <Select label="Queue" value={draft.queueId} disabled={!editable} onChange={(queueId) => patch({ queueId })} options={(queues.length ? queues : [{ id: "main", name: "Main" } as Queue]).map((queue) => [queue.id, queue.name])} />
            <Field label="Speed limit"><input disabled={!editable} value={draft.maxDownloadLimit} onChange={(event) => patch({ maxDownloadLimit: event.target.value })} placeholder="2M, 500K, or blank" className="control font-mono" /></Field>
            <Field label="Connections"><input disabled={!editable} type="number" min="0" max="16" value={draft.connections} onChange={(event) => patch({ connections: Number(event.target.value) || 0 })} className="control" /></Field>
            <Field label="Split"><input disabled={!editable} type="number" min="0" max="64" value={draft.split} onChange={(event) => patch({ split: Number(event.target.value) || 0 })} className="control" /></Field>
            <Field label="Retries"><input disabled={!editable} type="number" min="0" max="20" value={draft.retries} onChange={(event) => patch({ retries: Number(event.target.value) || 0 })} className="control" /></Field>
            <Field label="Proxy"><input disabled={!editable} value={draft.proxy} onChange={(event) => patch({ proxy: event.target.value })} placeholder="http://host:port" className="control font-mono" /></Field>
            <Field label="User-Agent"><input disabled={!editable} value={draft.userAgent} onChange={(event) => patch({ userAgent: event.target.value })} className="control font-mono" /></Field>
          </div>
          <Field label="Headers"><textarea disabled={!editable} value={draft.headers.join("\n")} onChange={(event) => patch({ headers: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) })} placeholder="One header per line" className="control min-h-20 resize-y font-mono" /></Field>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {editable && <button className="btn-primary" onClick={save}>Save profile</button>}
          {editable && <button className="btn-ghost text-rose-300" onClick={remove}><I.Trash className="w-4 h-4" /> Delete</button>}
          {draft.builtin && <span className="text-xs text-slate-500">Built-in profiles are read-only. Duplicate one to customize it.</span>}
          {message && <span className="text-xs text-slate-500 min-w-0 break-words">{message}</span>}
        </div>
        {validation && (!validation.valid || validation.warnings.length > 0) && (
          <div className="space-y-1">
            {validation.errors.map((error) => <div key={error} className="px-3 py-2 border border-rose-500/30 bg-rose-500/10 text-xs text-rose-200">{error}</div>)}
            {validation.warnings.map((warning) => <div key={warning} className="px-3 py-2 border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">{warning}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function split(value: string): string[] {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0"><span className="block text-xs text-slate-500 mb-1">{label}</span>{children}</label>;
}

function Select({ label, value, disabled, onChange, options }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void; options: string[][] }) {
  return <Field label={label}><div className="relative"><select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className="control appearance-none pr-9">{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><I.Down className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" /></div></Field>;
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" disabled={disabled} checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
