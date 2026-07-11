import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, LifeBuoy } from 'lucide-react';

const CATEGORIES = [
  {
    title: 'General',
    items: [
      { q: 'What is Skootlink?', a: 'Skootlink is a digital platform that connects independent vehicle owners with gig-economy drivers who need temporary access to cars, scooters, vans, and motorbikes. We provide a safe, formal way to rent vehicles with digital contracts, optional identity verification, and communication tools built into the app.' },
      { q: 'Is Skootlink free to use?', a: 'Yes. Registering an account on Skootlink is completely free. All new users receive a generous amount of free sign-up credits so they can start browsing, chatting, listing vehicles, and signing rental contracts straight away. There are no monthly subscriptions or hidden fees to get started.' },
      { q: 'Who can use Skootlink?', a: <>Anyone over 18 with a valid email address or phone number can register. You can join as a <strong>Driver</strong> (looking to rent a vehicle for delivery or transport work) or an <strong>Owner</strong> (listing your vehicle to earn extra income).</> },
      { q: 'Do I need a South African ID to use Skootlink?', a: 'No. You can register and use the platform with just an email address. Identity verification is completely optional and gives you a verified badge on your profile.' },
      { q: 'Is Skootlink available on Android and iPhone?', a: 'Yes. Skootlink works on any modern web browser on your phone, tablet, or computer. We are also available on the Google Play Store as an Android app, and an iOS version is coming soon.' },
    ],
  },
  {
    title: 'For Drivers',
    items: [
      { q: 'How do I find a vehicle to rent?', a: <>Tap the <strong>Search</strong> tab at the bottom of the app. You'll see vehicles available near you. You can filter by type (car, scooter, motorbike, van), location, and price. When you find one you like, send a message to the owner to start the rental process.</> },
      { q: 'How does the rental process work?', a: (
        <ol className="list-decimal list-inside space-y-1">
          <li>Find a vehicle and send a rental proposal to the owner.</li>
          <li>The owner reviews your profile and accepts or declines.</li>
          <li>Both parties sign a digital rental contract through the app.</li>
          <li>You pick up the vehicle and start delivering.</li>
          <li>Return the vehicle at the agreed time.</li>
        </ol>
      ) },
      { q: 'What happens if I damage the vehicle?', a: 'The rental contract you sign with the owner specifies liability and deposit terms. Skootlink provides a formal contract that protects both parties, but damage disputes are resolved between the driver and owner. We encourage owners to have insurance and to photograph the vehicle before and after each rental.' },
    ],
  },
  {
    title: 'For Owners',
    items: [
      { q: 'How do I list my vehicle?', a: <>Tap <strong>Add Vehicle</strong> from the Dashboard or Briefcase tab. Upload photos, enter the make, model, year, registration number, location, and your weekly price. Once published, drivers can find it in the search results.</> },
      { q: 'How do I approve a driver?', a: <>When a driver sends a rental proposal, you'll see it in your Dashboard under <strong>Pending Proposals</strong>. You can view the driver's profile, including any verification badges, and choose to accept or decline. If accepted, a digital contract is generated for both parties to sign.</> },
      { q: "What if a driver doesn't return my vehicle on time?", a: 'The digital contract includes start and end dates. If a driver is late, the contract terms apply. We recommend discussing any delays directly with the driver via in-app messaging. For repeated issues, you can block the driver from renting your vehicles in the future.' },
      { q: 'Do I need insurance?', a: 'Yes. You must have valid motor insurance appropriate for rental use. Skootlink does not provide insurance; it is your responsibility to ensure your vehicle is covered while rented out.' },
    ],
  },
  {
    title: 'Trust & Safety',
    items: [
      { q: 'How does Skootlink keep me safe?', a: (
        <>
          We've built several safety features:
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li><strong>Digital contracts</strong> — Legally binding agreements signed in the app.</li>
            <li><strong>Optional verification badges</strong> — Identity and licence checks for users who want to build trust.</li>
            <li><strong>In-app messaging</strong> — No need to share your phone number until a contract is signed.</li>
            <li><strong>Ratings &amp; reviews</strong> — Honest feedback helps everyone make informed decisions.</li>
          </ul>
        </>
      ) },
      { q: 'What is a Verified badge?', a: "Users who choose to verify their identity or driving licence get a badge on their profile (✅ ID Verified or 🛡️ Fully Verified). This lets others know their details have been checked by our team. Verification is optional and does not guarantee a person's trustworthiness, but it's a strong signal of good faith." },
      { q: 'Can I block or report another user?', a: 'Yes. You can report inappropriate behaviour through the Messages page, and you can block a user from contacting you or renting your vehicle. Skootlink can also suspend or ban users who violate our Terms of Service.' },
    ],
  },
  {
    title: 'Account & Profile',
    items: [
      { q: 'How do I change my password?', a: <>Go to <strong>Settings</strong> → <strong>Security</strong> → <strong>Change Password</strong>. Enter your current password and a new one.</> },
      { q: 'How do I delete my account?', a: <>Go to <strong>Settings</strong> → <strong>Security</strong> → <strong>Delete Account</strong>. You'll need to confirm your identity and type "DELETE" to finalise. This permanently removes your profile, listings, and rental history.</> },
      { q: 'Can I switch between Driver and Owner?', a: <>Yes. You can switch your role at any time from your <strong>Profile</strong> page.</> },
    ],
  },
  {
    title: 'Contracts & Briefcase',
    items: [
      { q: 'What is a digital contract?', a: "It's a legally binding rental agreement between you and the other party, generated and signed inside the Skootlink app. It outlines the vehicle, rental dates, weekly rate, deposit, and responsibilities of both parties." },
      { q: 'Can I download my contracts?', a: <>Yes. All signed contracts are stored in your <strong>Briefcase</strong> tab. You can download them as PDF files at any time.</> },
      { q: 'What happens if I lose a signed contract?', a: 'Your contracts are stored securely in your Briefcase and can be re-downloaded at any time. You\'ll never lose access to them while your account is active.' },
    ],
  },
];

export default function FAQPage() {
  const navigate = useNavigate();
  const [openKey, setOpenKey] = useState(null);

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto pb-24">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-bold text-foreground mb-1">Frequently Asked Questions</h1>
      <p className="text-sm text-muted-foreground mb-6">Everything you need to know about using Skootlink.</p>

      <div className="space-y-6">
        {CATEGORIES.map(({ title, items }) => (
          <div key={title}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</h2>
            <div className="space-y-2">
              {items.map(({ q, a }) => {
                const key = `${title}-${q}`;
                const isOpen = openKey === key;
                return (
                  <div key={key} className="border border-border rounded-xl overflow-hidden bg-card">
                    <button
                      onClick={() => setOpenKey(isOpen ? null : key)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-accent transition-colors"
                    >
                      {q}
                      <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-3 text-sm text-muted-foreground leading-relaxed">
                        {a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 p-4 rounded-xl bg-primary/5 border border-primary/20 text-center">
        <LifeBuoy className="w-5 h-5 text-primary mx-auto mb-2" />
        <p className="text-sm font-medium text-foreground mb-1">Still need help?</p>
        <p className="text-xs text-muted-foreground mb-3">Can't find what you're looking for?</p>
        <button
          onClick={() => navigate('/contact')}
          className="text-sm font-semibold text-primary hover:underline"
        >
          Contact Support →
        </button>
      </div>
    </div>
  );
}
