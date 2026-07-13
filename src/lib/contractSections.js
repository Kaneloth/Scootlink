/**
 * contractSections.js — generates the full Vehicle Rental Agreement as
 * structured section data, for use with ContractSectionsList /
 * ContractSectionEditor. This is the structured replacement for the old
 * generateContractText() template-literal function in Dashboard.jsx.
 *
 * Every section — including the opening preamble (parties) and the closing
 * signature text, which aren't numbered clauses but still need to be
 * editable for "full control over content and structure" to actually mean
 * that — follows the exact same shape, so ContractSectionEditor handles all
 * of them uniformly.
 *
 * Place at: src/lib/contractSections.js
 */

const emptyBullet = (text = '') => ({ text, subBullets: [] });

export function generateContractSections(rental, vehicle, driverProfile, ownerUser) {
  const today = new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });
  const ownerName = ownerUser?.full_name || '';
  const ownerIdNo = ownerUser?.id_number || ownerUser?.passport_number || '';
  const driverName = driverProfile?.full_name || '';
  const driverIdNo = driverProfile?.id_number || driverProfile?.passport_number || '';
  const licenseNumber = driverProfile?.license_number || '';
  const vType = vehicle?.vehicle_type || vehicle?.type || '';
  const vMake = vehicle?.make || '';
  const vModel = vehicle?.model || '';
  const vYear = vehicle?.year || '';

  return [
    // ── Preamble — unnumbered, the parties and effective date ───────────────
    {
      id: 'preamble',
      number: null,
      title: 'VEHICLE RENTAL AGREEMENT',
      fields: [
        { label: 'Effective Date', value: today },
        { label: 'Owner', value: ownerName },
        { label: "Owner's ID/Passport No", value: ownerIdNo },
        { label: 'Driver (Renter)', value: driverName },
        { label: "Driver's ID/Passport No", value: driverIdNo },
      ],
      intro: 'This Vehicle Rental Agreement ("Agreement") is entered into between the Owner and the Driver named above.',
      bullets: [],
      subsections: [],
    },

    // ── 1. Vehicle Details ───────────────────────────────────────────────────
    {
      id: 'vehicle-details',
      number: '1',
      title: 'VEHICLE DETAILS',
      fields: [
        { label: 'Type', value: vType },
        { label: 'Make', value: vMake },
        { label: 'Model', value: vModel },
        { label: 'Year', value: String(vYear || '') },
        { label: 'Current Odometer Reading', value: '' },
      ],
      intro: '',
      bullets: [],
      subsections: [],
    },

    // ── 2. Rental Terms ───────────────────────────────────────────────────────
    {
      id: 'rental-terms',
      number: '2',
      title: 'RENTAL TERMS',
      fields: [
        { label: 'Rental Start Date', value: rental?.start_date || '' },
        { label: 'Rental End Date', value: rental?.end_date || '' },
        { label: 'Weekly Rate', value: rental?.price_per_week ? `R ${rental.price_per_week}` : '' },
        { label: 'Security Deposit', value: rental?.deposit ? `R ${rental.deposit}` : '' },
      ],
      intro: 'The security deposit shall be refundable upon return of the vehicle, subject to inspection. Any damages, fines, or additional charges will be deducted from the deposit.',
      bullets: [],
      subsections: [],
    },

    // ── 3. Driver Requirements ───────────────────────────────────────────────
    {
      id: 'driver-requirements',
      number: '3',
      title: 'DRIVER REQUIREMENTS',
      fields: [
        { label: "Driver's Licence Number", value: licenseNumber },
      ],
      intro: 'The Driver confirms that:',
      bullets: [
        emptyBullet('They are at least 18 years of age.'),
        emptyBullet("They hold a valid and legal driver's licence."),
        emptyBullet('They are capable of operating the vehicle safely.'),
        emptyBullet('For motorcycles or scooters: a helmet must be worn at all times.'),
        emptyBullet('Only one rider is permitted unless the vehicle is designed for two riders.'),
      ],
      subsections: [],
    },

    // ── 4. Use and Operating Conditions ──────────────────────────────────────
    {
      id: 'use-conditions',
      number: '4',
      title: 'USE AND OPERATING CONDITIONS',
      fields: [],
      intro: 'The Driver agrees to:',
      bullets: [
        emptyBullet('Comply with all traffic laws and regulations.'),
        emptyBullet('Observe all speed limits.'),
        emptyBullet('Not operate the vehicle under the influence of alcohol or drugs.'),
        emptyBullet('Not use the vehicle on restricted roads where prohibited.'),
        emptyBullet('Park only in designated and lawful areas.'),
        emptyBullet('Immediately report any accident, damage, or mechanical issue.'),
        emptyBullet('Not allow any unauthorised person to operate the vehicle.'),
        emptyBullet('Not use the vehicle for illegal purposes.'),
      ],
      subsections: [],
    },

    // ── 5. Owner's Responsibilities ──────────────────────────────────────────
    {
      id: 'owner-responsibilities',
      number: '5',
      title: "OWNER'S RESPONSIBILITIES",
      fields: [],
      intro: 'The Owner agrees to:',
      bullets: [
        emptyBullet('Ensure the vehicle is roadworthy and complies with all legal safety requirements.'),
        emptyBullet('Provide necessary safety equipment (e.g., helmet where applicable).'),
        emptyBullet('Maintain valid insurance coverage for the vehicle.'),
        emptyBullet('Ensure the vehicle is fitted with a functional tracking device (where applicable).'),
      ],
      subsections: [],
    },

    // ── 6. Liability and Damages ─────────────────────────────────────────────
    {
      id: 'liability-damages',
      number: '6',
      title: 'LIABILITY AND DAMAGES',
      fields: [],
      intro: '',
      bullets: [
        emptyBullet('The Driver assumes responsibility for the vehicle during the rental period.'),
        { text: 'The Driver is liable for:', subBullets: ['Traffic fines, penalties, and violations;', 'Damage beyond normal wear and tear.'] },
        emptyBullet('The Owner shall not be liable for injury, loss, or damage resulting from use of the vehicle, except where required by law.'),
        emptyBullet('Insurance shall cover applicable risks; however, any excess, exclusions, or uncovered costs shall be borne by the Driver.'),
      ],
      subsections: [],
    },

    // ── 7. Return of Vehicle ─────────────────────────────────────────────────
    {
      id: 'return-vehicle',
      number: '7',
      title: 'RETURN OF VEHICLE',
      fields: [],
      intro: '',
      bullets: [
        emptyBullet('The vehicle must be returned on or before the rental end date.'),
        emptyBullet('The vehicle must be returned in the same condition as received, excluding normal wear and tear.'),
        emptyBullet('Late returns may incur additional charges.'),
        emptyBullet('The Owner reserves the right to inspect the vehicle upon return.'),
      ],
      subsections: [],
    },

    // ── 8. Termination — the section with real subsections ──────────────────
    {
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
            emptyBullet('Breaches any material term; and'),
            emptyBullet('Fails to remedy such breach within a reasonable period (not exceeding 48 hours) after written notice.'),
          ],
        },
        {
          id: 'termination-8-2', number: '8.2', title: "Owner's Right to Terminate", fields: [],
          intro: 'The Owner may terminate immediately and reclaim the vehicle if:',
          bullets: [
            emptyBullet('The vehicle is used illegally or recklessly;'),
            emptyBullet('The Driver commits serious traffic violations;'),
            emptyBullet('There is a risk of damage, loss, or theft;'),
            emptyBullet('The Driver provides false or misleading information.'),
          ],
        },
        {
          id: 'termination-8-3', number: '8.3', title: "Driver's Right to Terminate", fields: [],
          intro: 'The Driver may terminate immediately if:',
          bullets: [
            emptyBullet('The vehicle is not roadworthy or safe;'),
            emptyBullet('The Owner fails to provide valid insurance;'),
            emptyBullet('The vehicle does not match its description;'),
            emptyBullet('The Owner fails to fulfil a material obligation.'),
          ],
        },
        {
          id: 'termination-8-4', number: '8.4', title: 'Termination for Convenience (No Breach)', fields: [],
          intro: 'Either party may terminate this Agreement without cause by giving written notice of __ hours/days.',
          bullets: [
            emptyBullet('The Driver must return the vehicle by the termination date.'),
          ],
        },
        {
          id: 'termination-8-5', number: '8.5', title: 'Financial Consequences of Termination', fields: [],
          intro: '',
          bullets: [
            emptyBullet('The Owner shall refund any unused rental fees on a pro-rata basis.'),
            { text: 'The deposit shall be refunded subject to deductions for:', subBullets: [
              'Damages;', 'Outstanding fees or penalties;', 'Reasonable early termination costs.',
            ] },
            emptyBullet('An early termination fee of __ (if applicable) may apply.'),
          ],
        },
        {
          id: 'termination-8-6', number: '8.6', title: 'Exceptional Circumstances', fields: [],
          intro: 'Either party may terminate immediately without penalty due to:',
          bullets: [
            emptyBullet('Medical emergencies;'),
            emptyBullet('Safety risks;'),
            emptyBullet('Events beyond reasonable control (force majeure).'),
          ],
        },
        {
          id: 'termination-8-7', number: '8.7', title: 'Effects of Termination', fields: [],
          intro: '',
          bullets: [
            emptyBullet('The vehicle must be returned immediately upon termination.'),
            emptyBullet('A joint inspection is recommended upon return.'),
            emptyBullet('Any outstanding liabilities shall remain enforceable after termination.'),
          ],
        },
      ],
    },

    // ── 9. General Terms ──────────────────────────────────────────────────────
    {
      id: 'general-terms',
      number: '9',
      title: 'GENERAL TERMS',
      fields: [],
      intro: '',
      bullets: [
        emptyBullet('This Agreement constitutes the entire agreement between the parties.'),
        emptyBullet('Any amendments must be in writing and agreed to by both parties.'),
        emptyBullet('This Agreement shall be governed by the laws of __________.'),
      ],
      subsections: [],
    },

    // ── Closing — unnumbered, the digital-signature statement ────────────────
    {
      id: 'closing',
      number: null,
      title: 'AGREEMENT',
      fields: [],
      intro: 'By checking the box and clicking "Accept & Sign Agreement" / "Confirm & Finalize Rental", both parties confirm they have read, understood, and agreed to this Agreement. This constitutes a valid digital signature.',
      bullets: [],
      subsections: [],
    },
  ];
}
