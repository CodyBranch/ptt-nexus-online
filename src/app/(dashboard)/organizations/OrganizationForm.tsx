'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createOrganization, updateOrganization } from './actions';
import { ORGANIZATION_TYPES, NCAA_DIVISIONS, US_STATES } from '@/types';
import type { OrganizationRow } from '@/types';

interface Props {
  organization?: OrganizationRow | null;
}

export default function OrganizationForm({ organization }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const isEdit = !!organization;

  // Form state
  const [name, setName] = useState(organization?.name ?? '');
  const [abbreviation, setAbbreviation] = useState(organization?.abbreviation ?? '');
  const [shortName, setShortName] = useState(organization?.shortName ?? '');
  const [mascot, setMascot] = useState(organization?.mascot ?? '');
  const [organizationType, setOrganizationType] = useState(organization?.organizationType ?? 'high_school');
  const [genderDesignation, setGenderDesignation] = useState(organization?.genderDesignation ?? '');
  const [ncaaDivision, setNcaaDivision] = useState(organization?.ncaaDivision ?? '');
  const [naiaMember, setNaiaMember] = useState(organization?.naiaMember ?? false);
  const [jucoMember, setJucoMember] = useState(organization?.jucoMember ?? false);
  const [conference, setConference] = useState(organization?.conference ?? '');
  const [subConference, setSubConference] = useState(organization?.subConference ?? '');
  const [stateAssociation, setStateAssociation] = useState(organization?.stateAssociation ?? '');
  const [city, setCity] = useState(organization?.city ?? '');
  const [state, setState] = useState(organization?.state ?? '');
  const [country, setCountry] = useState(organization?.country ?? 'USA');
  const [primaryColor, setPrimaryColor] = useState(organization?.primaryColor ?? '#3b82f6');
  const [secondaryColor, setSecondaryColor] = useState(organization?.secondaryColor ?? '#000000');
  const [headCoach, setHeadCoach] = useState(organization?.headCoach ?? '');
  const [assistantCoach, setAssistantCoach] = useState(organization?.assistantCoach ?? '');
  const [athleticDirector, setAthleticDirector] = useState(organization?.athleticDirector ?? '');
  const [contactEmail, setContactEmail] = useState(organization?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(organization?.contactPhone ?? '');
  const [website, setWebsite] = useState(organization?.website ?? '');
  const [tfrrsId, setTfrrsId] = useState(organization?.tfrrsId ?? '');
  const [athleticNetId, setAthleticNetId] = useState(organization?.athleticNetId ?? '');
  const [directAthleticsId, setDirectAthleticsId] = useState(organization?.directAthleticsId ?? '');
  const [milesplitId, setMilesplitId] = useState(organization?.milesplitId ?? '');
  const [notes, setNotes] = useState(organization?.notes ?? '');

  const [showAdvanced, setShowAdvanced] = useState(isEdit);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !abbreviation.trim()) {
      setError('Name and abbreviation are required');
      return;
    }
    setError('');

    const data = {
      name: name.trim(),
      abbreviation: abbreviation.trim().toUpperCase(),
      shortName: shortName.trim() || undefined,
      mascot: mascot.trim() || undefined,
      organizationType,
      genderDesignation: genderDesignation || undefined,
      ncaaDivision: ncaaDivision || undefined,
      naiaMember,
      jucoMember,
      conference: conference.trim() || undefined,
      subConference: subConference.trim() || undefined,
      stateAssociation: stateAssociation.trim() || undefined,
      city: city.trim() || undefined,
      state: state || undefined,
      country: country.trim() || undefined,
      primaryColor: primaryColor || undefined,
      secondaryColor: secondaryColor || undefined,
      headCoach: headCoach.trim() || undefined,
      assistantCoach: assistantCoach.trim() || undefined,
      athleticDirector: athleticDirector.trim() || undefined,
      contactEmail: contactEmail.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
      website: website.trim() || undefined,
      tfrrsId: tfrrsId.trim() || undefined,
      athleticNetId: athleticNetId.trim() || undefined,
      directAthleticsId: directAthleticsId.trim() || undefined,
      milesplitId: milesplitId.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    startTransition(async () => {
      try {
        if (isEdit && organization) {
          await updateOrganization(organization.id, data);
        } else {
          await createOrganization(data);
        }
        router.push('/organizations');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    });
  }

  const inputClass = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500';
  const labelClass = 'block text-xs text-gray-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Section: Identity */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Identity</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Vanderbilt University" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Abbreviation *</label>
            <input type="text" value={abbreviation} onChange={(e) => setAbbreviation(e.target.value)}
              placeholder="VAND" className={inputClass} maxLength={10} />
          </div>
          <div>
            <label className={labelClass}>Short Name</label>
            <input type="text" value={shortName} onChange={(e) => setShortName(e.target.value)}
              placeholder="Vandy" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Mascot</label>
            <input type="text" value={mascot} onChange={(e) => setMascot(e.target.value)}
              placeholder="Commodores" className={inputClass} />
          </div>
        </div>
      </div>

      {/* Section: Classification */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Classification</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Type *</label>
            <select value={organizationType} onChange={(e) => setOrganizationType(e.target.value)}
              className={inputClass}>
              {ORGANIZATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Gender Designation</label>
            <select value={genderDesignation} onChange={(e) => setGenderDesignation(e.target.value)}
              className={inputClass}>
              <option value="">Not specified</option>
              <option value="men">Men</option>
              <option value="women">Women</option>
              <option value="coed">Coed</option>
            </select>
          </div>
          {organizationType === 'college' && (
            <>
              <div>
                <label className={labelClass}>NCAA Division</label>
                <select value={ncaaDivision} onChange={(e) => setNcaaDivision(e.target.value)}
                  className={inputClass}>
                  <option value="">N/A</option>
                  {NCAA_DIVISIONS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input type="checkbox" checked={naiaMember} onChange={(e) => setNaiaMember(e.target.checked)}
                    className="rounded border-gray-600" />
                  NAIA
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input type="checkbox" checked={jucoMember} onChange={(e) => setJucoMember(e.target.checked)}
                    className="rounded border-gray-600" />
                  JUCO
                </label>
              </div>
            </>
          )}
          <div>
            <label className={labelClass}>Conference</label>
            <input type="text" value={conference} onChange={(e) => setConference(e.target.value)}
              placeholder="SEC" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Sub-Conference / Region</label>
            <input type="text" value={subConference} onChange={(e) => setSubConference(e.target.value)}
              placeholder="Region 7-AAAAAAA" className={inputClass} />
          </div>
          {(organizationType === 'high_school' || organizationType === 'middle_school') && (
            <div>
              <label className={labelClass}>State Association</label>
              <input type="text" value={stateAssociation} onChange={(e) => setStateAssociation(e.target.value)}
                placeholder="TSSAA" className={inputClass} />
            </div>
          )}
        </div>
      </div>

      {/* Section: Location */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Location</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>City</label>
            <input type="text" value={city} onChange={(e) => setCity(e.target.value)}
              placeholder="Nashville" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>State</label>
            <select value={state} onChange={(e) => setState(e.target.value)} className={inputClass}>
              <option value="">Select</option>
              {US_STATES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Country</label>
            <input type="text" value={country} onChange={(e) => setCountry(e.target.value)}
              placeholder="USA" className={inputClass} />
          </div>
        </div>
      </div>

      {/* Section: Branding */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Branding</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Primary Color</label>
            <div className="flex items-center gap-3">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-10 h-10 rounded border border-gray-700 bg-transparent cursor-pointer" />
              <input type="text" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#3b82f6" className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Secondary Color</label>
            <div className="flex items-center gap-3">
              <input type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)}
                className="w-10 h-10 rounded border border-gray-700 bg-transparent cursor-pointer" />
              <input type="text" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)}
                placeholder="#000000" className={inputClass} />
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-3">Logo upload will be available once Supabase Storage is configured.</p>
      </div>

      {/* Advanced sections (toggle) */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
      >
        {showAdvanced ? 'Hide' : 'Show'} Contact, External IDs & Notes
      </button>

      {showAdvanced && (
        <>
          {/* Section: Contact */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Contact</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Head Coach</label>
                <input type="text" value={headCoach} onChange={(e) => setHeadCoach(e.target.value)}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Assistant Coach</label>
                <input type="text" value={assistantCoach} onChange={(e) => setAssistantCoach(e.target.value)}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Athletic Director</label>
                <input type="text" value={athleticDirector} onChange={(e) => setAthleticDirector(e.target.value)}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Website</label>
                <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://..." className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Contact Email</label>
                <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Contact Phone</label>
                <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                  className={inputClass} />
              </div>
            </div>
          </div>

          {/* Section: External IDs */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">External IDs</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>TFRRS ID</label>
                <input type="text" value={tfrrsId} onChange={(e) => setTfrrsId(e.target.value)}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Athletic.net ID</label>
                <input type="text" value={athleticNetId} onChange={(e) => setAthleticNetId(e.target.value)}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>DirectAthletics ID</label>
                <input type="text" value={directAthleticsId} onChange={(e) => setDirectAthleticsId(e.target.value)}
                  className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>MileSplit ID</label>
                <input type="text" value={milesplitId} onChange={(e) => setMilesplitId(e.target.value)}
                  className={inputClass} />
              </div>
            </div>
          </div>

          {/* Section: Notes */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Notes</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={inputClass}
              placeholder="Internal notes..."
            />
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Organization'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/organizations')}
          className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
