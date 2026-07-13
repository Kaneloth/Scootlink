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
  subsections: [],
};

// Real Section 8 (Termination) content — the most structurally complex
// section in the template, with genuine 8.1–8.7 subsections and, within
// 8.5, real sub-bullets too. This is the actual proof that the recursive
// subsection editor handles the hardest real case, not just a toy example.
const TERMINATION_SECTION = {
  id: 'termination',
  number: '8',
  title: 'TERMINATION',
  fields: [],
  intro: '',
  bullets: [],
  subsections: [
    {
      id: 'termination-8-1', number: '8.1', title: 'Termination for Breach', fields: [],
      intro: 'Either party may terminate this Agreement immediately by written notice if the other party:',
      bullets: [
        { text: 'Breaches any material term; and', subBullets: [] },
        { text: 'Fails to remedy such breach within a reasonable period (not exceeding 48 hours) after written notice.', subBullets: [] },
      ],
    },
    {
      id: 'termination-8-2', number: '8.2', title: "Owner's Right to Terminate", fields: [],
      intro: 'The Owner may terminate immediately and reclaim the vehicle if:',
      bullets: [
        { text: 'The vehicle is used illegally or recklessly;', subBullets: [] },
        { text: 'The Driver commits serious traffic violations;', subBullets: [] },
        { text: 'There is a risk of damage, loss, or theft;', subBullets: [] },
        { text: 'The Driver provides false or misleading information.', subBullets: [] },
      ],
    },
    {
      id: 'termination-8-3', number: '8.3', title: "Driver's Right to Terminate", fields: [],
      intro: 'The Driver may terminate immediately if:',
      bullets: [
        { text: 'The vehicle is not roadworthy or safe;', subBullets: [] },
        { text: 'The Owner fails to provide valid insurance;', subBullets: [] },
        { text: 'The vehicle does not match its description;', subBullets: [] },
        { text: 'The Owner fails to fulfil a material obligation.', subBullets: [] },
      ],
    },
    {
      id: 'termination-8-4', number: '8.4', title: 'Termination for Convenience (No Breach)', fields: [],
      intro: 'Either party may terminate this Agreement without cause by giving written notice of __ hours/days.',
      bullets: [
        { text: 'The Driver must return the vehicle by the termination date.', subBullets: [] },
      ],
    },
    {
      id: 'termination-8-5', number: '8.5', title: 'Financial Consequences of Termination', fields: [],
      intro: '',
      bullets: [
        { text: 'The Owner shall refund any unused rental fees on a pro-rata basis.', subBullets: [] },
        { text: 'The deposit shall be refunded subject to deductions for:', subBullets: [
          'Damages;', 'Outstanding fees or penalties;', 'Reasonable early termination costs.',
        ] },
        { text: 'An early termination fee of __ (if applicable) may apply.', subBullets: [] },
      ],
    },
    {
      id: 'termination-8-6', number: '8.6', title: 'Exceptional Circumstances', fields: [],
      intro: 'Either party may terminate immediately without penalty due to:',
      bullets: [
        { text: 'Medical emergencies;', subBullets: [] },
        { text: 'Safety risks;', subBullets: [] },
        { text: 'Events beyond reasonable control (force majeure).', subBullets: [] },
      ],
    },
    {
      id: 'termination-8-7', number: '8.7', title: 'Effects of Termination', fields: [],
      intro: '',
      bullets: [
        { text: 'The vehicle must be returned immediately upon termination.', subBullets: [] },
        { text: 'A joint inspection is recommended upon return.', subBullets: [] },
        { text: 'Any outstanding liabilities shall remain enforceable after termination.', subBullets: [] },
      ],
    },
  ],
};

export default function ContractBuilderTest() {
  const navigate = useNavigate();
  const [section, setSection] = useState(INITIAL_SECTION);
  const [termination, setTermination] = useState(TERMINATION_SECTION);

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto pb-24">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-bold text-foreground mb-1">Contract Section Editor — Test</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Phase 2: subsections. The second section below (Termination) is the real 8.1–8.7 structure, including genuine sub-bullets within 8.5 — the most complex case in the whole template.
      </p>

      <div className="space-y-8">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Phase 1 — simple section</p>
          <ContractSectionEditor
            section={section}
            onChange={setSection}
            canDelete={false}
          />
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Phase 2 — section with subsections</p>
          <ContractSectionEditor
            section={termination}
            onChange={setTermination}
            canDelete={false}
          />
        </div>
      </div>

      <div className="mt-8">
        <p className="text-xs font-medium text-muted-foreground mb-2">Live data (for verification):</p>
        <pre className="text-[10px] bg-muted rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify({ section, termination }, null, 2)}
        </pre>
      </div>
    </div>
  );
}
