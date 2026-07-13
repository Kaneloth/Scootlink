import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import ContractSectionEditor from '@/components/contract/ContractSectionEditor';

// Real Section 3 content from the current hardcoded template, restructured
// into the new data shape — see the note in chat about the two-intro-groups
// simplification made for this first test.
const INITIAL_SECTION = {
  id: 'driver-requirements',
  number: '3',
  title: 'DRIVER REQUIREMENTS',
  fields: [
    { label: "Driver's Licence Number", value: '' },
  ],
  intro: 'The Driver confirms that:',
  bullets: [
    { text: 'They are at least 18 years of age.', subBullets: [] },
    { text: "They hold a valid and legal driver's licence.", subBullets: [] },
    { text: 'They are capable of operating the vehicle safely.', subBullets: [] },
    { text: 'For motorcycles or scooters: a helmet must be worn at all times.', subBullets: [] },
    { text: 'Only one rider is permitted unless the vehicle is designed for two riders.', subBullets: [] },
  ],
};

export default function ContractBuilderTest() {
  const navigate = useNavigate();
  const [section, setSection] = useState(INITIAL_SECTION);

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto pb-24">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-bold text-foreground mb-1">Contract Section Editor — Test</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Phase 1 proof of concept. Try editing the title, adding/removing points, and adding sub-points.
      </p>

      <ContractSectionEditor
        section={section}
        onChange={setSection}
        canDelete={false}
      />

      <div className="mt-8">
        <p className="text-xs font-medium text-muted-foreground mb-2">Live data (for verification):</p>
        <pre className="text-[10px] bg-muted rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(section, null, 2)}
        </pre>
      </div>
    </div>
  );
}
