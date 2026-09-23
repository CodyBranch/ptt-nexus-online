'use client';

import { useState, useTransition } from 'react';
import { createTag, deleteTag, tagManyByName, type TagNode } from './actions';

const KIND_LABEL: Record<string, string> = {
  level: 'Level',
  governing_body: 'Governing body',
  conference: 'Conference',
  class: 'Class',
  region: 'Region',
};

/** What sits under what. A conference does not belong under a class. */
const KIND_UNDER: Record<string, string[]> = {
  level: ['governing_body', 'region'],
  governing_body: ['conference', 'class'],
  conference: [],
  class: [],
  region: [],
};

export default function TagTree({ tree }: { tree: TagNode[] }) {
  const [busy, startTransition] = useTransition();
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  /** Which tag the "add under this" form is open on. */
  const [addingUnder, setAddingUnder] = useState<TagNode | null>(null);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState('');
  /** Which tag the bulk-apply box is open on. */
  const [applyingTo, setApplyingTo] = useState<TagNode | null>(null);
  const [names, setNames] = useState('');

  const openAdd = (parent: TagNode | null) => {
    setAddingUnder(parent);
    setApplyingTo(null);
    setNewName('');
    setNewKind(parent ? (KIND_UNDER[parent.kind]?.[0] ?? 'class') : 'level');
    setNote(null);
  };

  const submitAdd = () => {
    startTransition(async () => {
      const r = await createTag({
        kind: newKind,
        name: newName,
        parentId: addingUnder?.id ?? null,
      });
      if (r.ok) { setAddingUnder(null); setNewName(''); setNote({ text: 'Added' }); }
      else setNote({ text: r.error, bad: true });
    });
  };

  const submitApply = () => {
    if (!applyingTo) return;
    const list = names.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    startTransition(async () => {
      const r = await tagManyByName(applyingTo.id, list);
      const parts: string[] = [];
      if (r.tagged.length) parts.push(`${r.tagged.length} tagged`);
      if (r.missing.length) parts.push(`${r.missing.length} not found: ${r.missing.slice(0, 4).join(', ')}`);
      setNote({ text: parts.join(' · ') || 'Nothing to do', bad: r.missing.length > 0 });
      if (r.missing.length === 0) { setApplyingTo(null); setNames(''); }
    });
  };

  const remove = (tag: TagNode) => {
    startTransition(async () => {
      const r = await deleteTag(tag.id);
      setNote(r.ok ? { text: `Removed ${tag.name}` } : { text: r.error, bad: true });
    });
  };

  const row = (tag: TagNode, depth: number) => (
    <div key={tag.id}>
      <div
        className="flex items-center gap-3 py-2 border-b border-gray-800 hover:bg-gray-800/40 group"
        style={{ paddingLeft: depth * 24 }}
      >
        <span className="text-[10px] uppercase tracking-wider text-gray-500 w-28 shrink-0">
          {KIND_LABEL[tag.kind] ?? tag.kind}
        </span>
        <span className="text-sm text-gray-100 flex-1 min-w-0 truncate">{tag.name}</span>
        <span className="text-xs text-gray-500 font-mono tabular-nums w-16 text-right">
          {tag.count.toLocaleString()}
        </span>
        <div className="flex items-center gap-2 w-56 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          {(KIND_UNDER[tag.kind]?.length ?? 0) > 0 && (
            <button onClick={() => openAdd(tag)} disabled={busy}
              className="text-[11px] text-blue-400 hover:text-blue-300">
              add under
            </button>
          )}
          <button onClick={() => { setApplyingTo(tag); setAddingUnder(null); setNames(''); setNote(null); }}
            disabled={busy} className="text-[11px] text-blue-400 hover:text-blue-300">
            apply to schools
          </button>
          {tag.count === 0 && tag.children.length === 0 && (
            <button onClick={() => remove(tag)} disabled={busy}
              className="text-[11px] text-gray-500 hover:text-red-400">
              remove
            </button>
          )}
        </div>
      </div>

      {addingUnder?.id === tag.id && (
        <div className="flex items-center gap-2 py-2 bg-gray-800/60 border-b border-gray-800"
          style={{ paddingLeft: (depth + 1) * 24 }}>
          <select value={newKind} onChange={(e) => setNewKind(e.target.value)}
            className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-200">
            {(KIND_UNDER[tag.kind] ?? []).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>
            ))}
          </select>
          <input
            autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) submitAdd(); }}
            placeholder={newKind === 'class' ? 'Class 1' : 'Name'}
            className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-200 w-56"
          />
          <button onClick={submitAdd} disabled={busy || !newName.trim()}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-xs">
            Add
          </button>
          <button onClick={() => setAddingUnder(null)} className="text-xs text-gray-500 hover:text-gray-300">
            Cancel
          </button>
        </div>
      )}

      {applyingTo?.id === tag.id && (
        <div className="py-3 px-4 bg-gray-800/60 border-b border-gray-800"
          style={{ paddingLeft: (depth + 1) * 24 }}>
          <p className="text-[11px] text-gray-400 mb-2">
            School names, one per line or comma separated. They are matched on the name
            exactly as this database spells it — anything not found is listed back rather
            than guessed at.
          </p>
          <textarea
            autoFocus value={names} onChange={(e) => setNames(e.target.value)} rows={5}
            placeholder={'Battle High School\nRock Bridge High School'}
            className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-gray-200 font-mono"
          />
          <div className="flex items-center gap-2 mt-2">
            <button onClick={submitApply} disabled={busy || !names.trim()}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-xs">
              {busy ? 'Applying…' : `Apply ${tag.name}`}
            </button>
            <button onClick={() => setApplyingTo(null)} className="text-xs text-gray-500 hover:text-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      {tag.children.map((c) => row(c, depth + 1))}
    </div>
  );

  return (
    <div>
      {note && (
        <div className={`mb-4 px-3 py-2 rounded text-sm border ${
          note.bad
            ? 'bg-red-500/10 border-red-500/30 text-red-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        }`}>
          {note.text}
        </div>
      )}

      <div className="flex items-center gap-3 pb-2 border-b border-gray-700 text-[10px] uppercase tracking-wider text-gray-500">
        <span className="w-28 shrink-0">Kind</span>
        <span className="flex-1">Tag</span>
        <span className="w-16 text-right">Schools</span>
        <span className="w-56" />
      </div>

      {tree.length === 0 ? (
        <p className="py-6 text-sm text-gray-500">
          No tags yet. Run the org_tags migration and they will be built from the
          levels, divisions and conferences the organisations already carry.
        </p>
      ) : tree.map((t) => row(t, 0))}

      <div className="mt-4">
        {addingUnder === null && newKind === 'level' ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Level name"
              className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-200 w-56"
            />
            <button onClick={submitAdd} disabled={busy || !newName.trim()}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-xs">
              Add level
            </button>
            <button onClick={() => setNewKind('')} className="text-xs text-gray-500 hover:text-gray-300">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => openAdd(null)} className="text-xs text-blue-400 hover:text-blue-300">
            + Add a level
          </button>
        )}
      </div>
    </div>
  );
}
