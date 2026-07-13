
import React from 'react';
import { Button } from '@/components/ui/button';
import { Plus, ChevronUp, ChevronDown } from 'lucide-react';
import ContractSectionEditor from './ContractSectionEditor';

/**
 * ContractSectionsList
 *
 * Owns the full ordered array of contract sections and renders one
 * ContractSectionEditor per section. Every section — whether it started as
 * one of the template's built-in nine or was added fresh by the user — is
 * exactly the same shape and equally editable/deletable/reorderable. There's
 * no special-cased "custom section" type; adding a new one just appends a
 * blank section using the same editor as everything else.
 */
export default function ContractSectionsList({ sections, onChange }) {
  const updateSection = (i, updated) => {
    const next = [...sections];
    next[i] = updated;
    onChange(next);
  };

  const deleteSection = (i) => {
    onChange(sections.filter((_, idx) => idx !== i));
  };

  const nextSectionNumber = () => {
    const nums = sections
      .map(s => parseInt(s.number, 10))
      .filter(n => !isNaN(n));
    return nums.length ? String(Math.max(...nums) + 1) : '1';
  };

  const addSection = () => {
    onChange([...sections, {
      id: `custom-${Date.now()}`,
      number: nextSectionNumber(),
      title: '',
      fields: [],
      intro: '',
      bullets: [{ text: '', subBullets: [] }],
      subsections: [],
    }]);
  };

  const moveSection = (i, direction) => {
    const target = i + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {sections.map((section, i) => (
        <div key={section.id} className="relative">
          {/* Reorder controls — sit above the section, out of the editor's
              own content so they don't get confused with in-section actions */}
          <div className="flex items-center gap-1 mb-1.5">
            <button
              onClick={() => moveSection(i, -1)}
              disabled={i === 0}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
              title="Move up"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => moveSection(i, 1)}
              disabled={i === sections.length - 1}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
              title="Move down"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] text-muted-foreground">Section {i + 1} of {sections.length}</span>
          </div>

          <ContractSectionEditor
            section={section}
            onChange={updated => updateSection(i, updated)}
            onDelete={() => deleteSection(i)}
            canDelete
          />
        </div>
      ))}

      <Button variant="outline" onClick={addSection} className="w-full rounded-xl gap-2">
        <Plus className="w-4 h-4" /> Add Section
      </Button>
    </div>
  );
}
