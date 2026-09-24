'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createOrganization, updateOrganization } from './actions';
import { ORGANIZATION_TYPES, NCAA_DIVISIONS, US_STATES } from '@/types';
import type { OrganizationRow } from '@/types';
import { classifyLogoUrl, LOGO_URL_WARNINGS } from './logo-url';
import { uploadOrgLogo } from './upload-logo';
import { resolveSubmission } from '../submissions/actions';

interface Props {
  organization?: OrganizationRow | null;
  /**
   * Values to start from when creating, rather than editing.
   *
   * Approving a submission used to run through a form of its own that
   * collected twelve fields, against the thirty-one here. The school arrived
   * in the database as a stub and somebody had to come back and finish it,
   * which is how a school ends up with no colours and no badge.
   *
   * Rather than a second form growing toward this one, the review flow sends
   * people here with the submission already filled in. One form, two ways in.
   */
  defaults?: Partial<OrganizationRow> | null;
  /** The submission this is being created from; closed out on save. */
  submissionId?: string | null;
}

export default function OrganizationForm({ organization, defaults, submissionId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const isEdit = !!organization;
  // The record being edited wins; a submission only fills what is blank.
  const start = organization ?? defaults ?? null;

  // Form state
  const [name, setName] = useState(start?.name ?? '');
  const [abbreviation, setAbbreviation] = useState(start?.abbreviation ?? '');
  const [shortName, setShortName] = useState(start?.shortName ?? '');
  const [mascot, setMascot] = useState(start?.mascot ?? '');
  const [organizationType, setOrganizationType] = useState(start?.organizationType ?? 'high_school');
  const [genderDesignation, setGenderDesignation] = useState(start?.genderDesignation ?? '');
  const [ncaaDivision, setNcaaDivision] = useState(start?.ncaaDivision ?? '');
  const [naiaMember, setNaiaMember] = useState(start?.naiaMember ?? false);
  const [jucoMember, setJucoMember] = useState(start?.jucoMember ?? false);
  const [conference, setConference] = useState(start?.conference ?? '');
  const [subConference, setSubConference] = useState(start?.subConference ?? '');
  const [stateAssociation, setStateAssociation] = useState(start?.stateAssociation ?? '');
  const [city, setCity] = useState(start?.city ?? '');
  const [state, setState] = useState(start?.state ?? '');
  const [country, setCountry] = useState(start?.country ?? 'USA');
  const [primaryColor, setPrimaryColor] = useState(start?.primaryColor ?? '#3b82f6');
  const [secondaryColor, setSecondaryColor] = useState(start?.secondaryColor ?? '#000000');
  const [logoUrl, setLogoUrl] = useState(start?.logoUrl ?? '');
  const [logoDarkUrl, setLogoDarkUrl] = useState(start?.logoDarkUrl ?? '');
  const [wordmarkUrl, setWordmarkUrl] = useState(start?.wordmarkUrl ?? '');
  const [headCoach, setHeadCoach] = useState(start?.headCoach ?? '');
  const [assistantCoach, setAssistantCoach] = useState(start?.assistantCoach ?? '');
  const [athleticDirector, setAthleticDirector] = useState(start?.athleticDirector ?? '');
  const [contactEmail, setContactEmail] = useState(start?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(start?.contactPhone ?? '');
  const [website, setWebsite] = useState(start?.website ?? '');
  const [tfrrsId, setTfrrsId] = useState(start?.tfrrsId ?? '');
  const [athleticNetId, setAthleticNetId] = useState(start?.athleticNetId ?? '');
  const [directAthleticsId, setDirectAthleticsId] = useState(start?.directAthleticsId ?? '');
  const [milesplitId, setMilesplitId] = useState(start?.milesplitId ?? '');
  const [notes, setNotes] = useState(start?.notes ?? '');

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
      // null, not undefined: the update action skips undefined fields, so
      // `|| undefined` (right for the colours, which always hold a value) would
      // make emptying a logo box a no-op. Clearing a bad URL has to stick.
      logoUrl: logoUrl.trim() || null,
      logoDarkUrl: logoDarkUrl.trim() || null,
      wordmarkUrl: wordmarkUrl.trim() || null,
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
          router.push('/organizations');
        } else {
          const created = await createOrganization(data);
          // Built from a submission: close that submission out against the
          // school that answered it, then go back to the queue rather than
          // the organisation list, because there are almost certainly more.
          if (submissionId && created?.id) {
            const res = await resolveSubmission(submissionId, created.id);
            if (!res.ok) {
              // The school was created either way; say what did not happen
              // rather than implying the whole save failed.
              setError(`Saved, but the submission could not be closed: ${res.error}`);
              return;
            }
            router.push('/submissions');
          } else {
            router.push('/organizations');
          }
        }
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
        <div className="mt-6 space-y-4">
          <LogoField label="Logo" value={logoUrl} onChange={setLogoUrl} variant="light" orgName={name}
            placeholder="https://example.org/logo.png" inputClass={inputClass} labelClass={labelClass} />
          <LogoField label="Logo for dark backgrounds" value={logoDarkUrl} onChange={setLogoDarkUrl} variant="dark" orgName={name}
            placeholder="https://example.org/logo-white.png" inputClass={inputClass} labelClass={labelClass} />
          <LogoField label="Wordmark" value={wordmarkUrl} onChange={setWordmarkUrl} variant="wordmark" orgName={name}
            placeholder="https://example.org/wordmark.svg" inputClass={inputClass} labelClass={labelClass} />
        </div>
        <p className="text-xs text-gray-600 mt-4">
          Upload a file, or paste the address of an image hosted somewhere else. Whatever is saved here is
          what the timing laptop downloads and draws, so if the preview is wrong here it is wrong there.
        </p>
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

/**
 * A logo URL, with the image it points at shown beside it.
 *
 * The preview sits on a checkerboard so a transparent PNG reads as transparent
 * rather than as a white box, and a URL that fails to load says so instead of
 * quietly leaving a gap — a logo that is broken should look broken here, which
 * is the whole point of being able to see it before the laptop does.
 */
function LogoField({
  label,
  value,
  onChange,
  placeholder,
  inputClass,
  labelClass,
  variant,
  orgName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputClass: string;
  labelClass: string;
  variant: "light" | "dark" | "wordmark";
  orgName: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("variant", variant);
      body.set("orgName", orgName || "logo");
      const res = await uploadOrgLogo(body);
      if (!res.ok) { setUploadError(res.error); return; }
      // Fill the box rather than saving straight away. The address is not
      // committed until the form is, so an upload can still be undone by
      // leaving without saving - and the preview beside it is the check.
      onChange(res.url);
      setFailedUrl(null);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "The upload failed");
    } finally {
      setUploading(false);
    }
  }
  const url = value.trim();
  const kind = classifyLogoUrl(url);
  const broken = kind === 'ok' && failedUrl === url;

  return (
    <div className="flex items-start gap-3">
      <div
        className="shrink-0 w-20 h-20 rounded-lg border border-gray-700 flex items-center justify-center overflow-hidden"
        style={{
          backgroundColor: '#1f2937',
          backgroundImage:
            'linear-gradient(45deg, #374151 25%, transparent 25%), linear-gradient(-45deg, #374151 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #374151 75%), linear-gradient(-45deg, transparent 75%, #374151 75%)',
          backgroundSize: '12px 12px',
          backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
        }}
      >
        {kind === 'empty' ? (
          <span className="text-[10px] text-gray-500 text-center px-1">No image</span>
        ) : kind === 'relative' ? (
          <span className="text-[10px] text-red-400 text-center px-1">Can&apos;t load</span>
        ) : broken ? (
          <span className="text-[10px] text-red-400 text-center px-1">Won&apos;t load</span>
        ) : (
          // Arbitrary external hosts, and the point is to render exactly what
          // the URL gives back — next/image would proxy and re-encode it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            className="max-w-full max-h-full object-contain"
            onError={() => setFailedUrl(url)}
            onLoad={() => setFailedUrl((f) => (f === url ? null : f))}
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <label className={labelClass}>{label}</label>
        {/* text, not url: an existing relative path would otherwise trip the
            browser's own validation and block the whole form behind a bubble
            that explains nothing. The warning below says it better. */}
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder} className={inputClass} />
        {kind === 'relative' && (
          <p className="mt-1 text-xs text-red-400">{LOGO_URL_WARNINGS.relative}</p>
        )}
        {kind === 'placeholder' && (
          <p className="mt-1 text-xs text-amber-400">{LOGO_URL_WARNINGS.placeholder}</p>
        )}
        {broken && (
          <p className="mt-1 text-xs text-red-400">
            Couldn&apos;t load this URL — the address is well formed but nothing came back.
          </p>
        )}

        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <label className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
            uploading
              ? "border-gray-800 text-gray-600 cursor-wait"
              : "border-gray-700 text-gray-300 hover:bg-gray-800 cursor-pointer"
          }`}>
            {uploading ? "Uploading…" : "Upload a file"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Cleared so that choosing the same file twice, after a
                // failure, still fires a change event.
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </label>
          {value.trim() && !uploading && (
            <button type="button" onClick={() => { onChange(""); setUploadError(null); }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              Clear
            </button>
          )}
          <span className="text-[11px] text-gray-600">
            PNG, JPEG, WebP, SVG or GIF, up to 2 MB. Stored with us, so it keeps working
            if the original site moves it.
          </span>
        </div>
        {uploadError && <p className="mt-1 text-xs text-red-400">{uploadError}</p>}
      </div>
    </div>
  );
}
