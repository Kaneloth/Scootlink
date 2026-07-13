import React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, X } from 'lucide-react';

/**
 * ContractSectionEditor
 *
 * One generic editor for a single contract section. Reused for all of the
 * template's built-in sections (Vehicle Details, Rental Terms, Driver
 * Requirements, etc.) and for user-added custom sections — they're all the
 * same shape underneath, just with different starting content.
 *
 * Section shape:
 *   {
 *     id: string,
 *     number: string | null,     // "1", "8.1", or null for unnumbered
 *     title: string,
 *     fields: [{ label, value }],  // simple label/value rows, e.g. Type/Make/Model
 *     intro: string,                // optional paragraph before the bullets
 *     bullets: [{ text, subBullets: string[] }],
 *   }
 *
 * Sub-bullets exist because the real contract has them (Section 6's "The
 * Driver is liable for: – Traffic fines... – Damage beyond..." and Section
 * 8.5's similar structure) — plain flat bullets aren't enough to represent
 * the actual template faithfully.
 */
export default function ContractSectionEditor({ section, onChange, onDelete, canDelete = true }) {
  const update = (patch) => onChange({ ...section, ...patch });

  // ── Fields (label/value pairs) ────────────────────────────────────────────
  const updateField = (i, patch) => {
    const fields = [...section.fields];
    fields[i] = { ...fields[i], ...patch };
    update({ fields });
  };
  const addField = () => update({ fields: [...section.fields, { label: '', value: '' }] });
  const removeField = (i) => update({ fields: section.fields.filter((_, idx) => idx !== i) });

  // ── Bullets ────────────────────────────────────────────────────────────────
  const updateBullet = (i, patch) => {
    const bullets = [...section.bullets];
    bullets[i] = { ...bullets[i], ...patch };
    update({ bullets });
  };
  const addBullet = () => update({ bullets: [...section.bullets, { text: '', subBullets: [] }] });
  const removeBullet = (i) => update({ bullets: section.bullets.filter((_, idx) => idx !== i) });

  // ── Sub-bullets (nested within a single bullet) ─────────────────────────────
  const addSubBullet = (bi) => {
    const bullets = [...section.bullets];
    bullets[bi] = { ...bullets[bi], subBullets: [...(bullets[bi].subBullets || []), ''] };
    update({ bullets });
  };
  const updateSubBullet = (bi, si, value) => {
    const bullets = [...section.bullets];
    const subBullets = [...(bullets[bi].subBullets || [])];
    subBullets[si] = value;
    bullets[bi] = { ...bullets[bi], subBullets };
    update({ bullets });
  };
  const removeSubBullet = (bi, si) => {
    const bullets = [...section.bullets];
    bullets[bi] = { ...bullets[bi], subBullets: (bullets[bi].subBullets || []).filter((_, idx) => idx !== si) };
    update({ bullets });
  };

  return (
    <div className="bg-card rounded-2xl border border-border p-4 space-y-4">
      {/* Section header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 grid grid-cols-[auto_1fr] gap-2 items-end">
          {section.number !== null && section.number !== undefined && (
            <div className="w-14">
              <Label className="text-xs font-medium">No.</Label>
              <Input
                value={section.number}
                onChange={e => update({ number: e.target.value })}
                className="mt-1 text-center"
                placeholder="1"
              />
            </div>
          )}
          <div>
            <Label className="text-xs font-medium">Section Title</Label>
            <Input
              value={section.title}
              onChange={e => update({ title: e.target.value })}
              className="mt-1"
              placeholder="e.g. Driver Requirements"
            />
          </div>
        </div>
        {canDelete && (
          <button
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-6"
            title="Delete section"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Fields (Type / Make / Model style rows) */}
      {section.fields.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs font-medium">Fields</Label>
          {section.fields.map((field, fi) => (
            <div key={fi} className="flex items-center gap-2">
              <Input
                value={field.label}
                onChange={e => updateField(fi, { label: e.target.value })}
                placeholder="Label"
                className="w-1/3 text-sm"
              />
              <Input
                value={field.value}
                onChange={e => updateField(fi, { value: e.target.value })}
                placeholder="Value"
                className="flex-1 text-sm"
              />
              <button onClick={() => removeField(fi)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button onClick={addField} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add field
      </button>

      {/* Intro paragraph */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Intro Text (optional)</Label>
        <Textarea
          value={section.intro}
          onChange={e => update({ intro: e.target.value })}
          placeholder="Any paragraph text that appears before the bullet points…"
          rows={2}
          className="text-sm resize-none"
        />
      </div>

      {/* Bullets, each with its own sub-bullets */}
      <div className="space-y-3">
        <Label className="text-xs font-medium">Points</Label>
        {section.bullets.map((bullet, bi) => (
          <div key={bi} className="space-y-1.5">
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground text-sm shrink-0 w-4 text-center pt-2">•</span>
              <Textarea
                value={bullet.text}
                onChange={e => updateBullet(bi, { text: e.target.value })}
                placeholder="Enter a point…"
                rows={1}
                className="flex-1 text-sm resize-none min-h-0 py-2"
              />
              <button onClick={() => removeBullet(bi)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0 pt-2">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Sub-bullets, indented under their parent bullet */}
            <div className="pl-8 space-y-1.5">
              {(bullet.subBullets || []).map((sub, si) => (
                <div key={si} className="flex items-start gap-2">
                  <span className="text-muted-foreground text-xs shrink-0 w-4 text-center pt-2">–</span>
                  <Input
                    value={sub}
                    onChange={e => updateSubBullet(bi, si, e.target.value)}
                    placeholder="Enter a sub-point…"
                    className="flex-1 text-sm"
                  />
                  <button onClick={() => removeSubBullet(bi, si)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => addSubBullet(bi)}
                className="flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80 transition-colors"
              >
                <Plus className="w-3 h-3" /> Add sub-point
              </button>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addBullet} className="w-full rounded-xl gap-2">
          <Plus className="w-4 h-4" /> Add point
        </Button>
      </div>
    </div>
  );
}
