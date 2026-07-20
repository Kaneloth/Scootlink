
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import ContractSectionsList from '@/components/contract/ContractSectionsList';
import { generateContractSections } from '@/lib/contractSections';

// Sample data standing in for a real rental/vehicle/profile — same shape
// generateContractSections() expects when wired into Dashboard.jsx for real.
const SAMPLE_RENTAL = { start_date: '2026-08-01', end_date: '2026-08-31', price_per_week: 650, deposit: 1500 };
const SAMPLE_VEHICLE = { vehicle_type: 'Car', make: 'Suzuki', model: 'Swift', year: 2023 };
const SAMPLE_DRIVER = { full_name: 'Kanelo Thelejane', id_number: '8802086603082', license_number: 'GP1234567' };
const SAMPLE_OWNER = { full_name: 'Skootlink Test Owner', id_number: '9001015800086' };

export default function ContractBuilderTest() {
  const navigate = useNavigate();
  const [sections, setSections] = useState(() =>
    generateContractSections(SAMPLE_RENTAL, SAMPLE_VEHICLE, SAMPLE_DRIVER, SAMPLE_OWNER)
  );

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto pb-24">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-bold text-foreground mb-1">Contract Section Editor — Test</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Phase 4a: the complete real contract — all 9 sections plus the preamble and closing signature text, generated from sample rental/vehicle/profile data exactly as it will be in the real flow.
      </p>

      <ContractSectionsList sections={sections} onChange={setSections} />

      <div className="mt-8">
        <p className="text-xs font-medium text-muted-foreground mb-2">Live data (for verification):</p>
        <pre className="text-[10px] bg-muted rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(sections, null, 2)}
        </pre>
      </div>
    </div>
  );
}
