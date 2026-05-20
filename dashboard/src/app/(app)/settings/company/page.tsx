"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import TopNav from '@/components/TopNav';
import { API_BASE_URL } from '@/lib/api';
import { getAuthToken } from '@/lib/auth';
import { DEFAULT_BUSINESS_MODULES, normalizeBusinessModules, type BusinessModules } from '@/lib/businessModules';
import UniversalModal from '@/components/modals/UniversalModal';
import Cropper, { type Area, type Point, type Size } from 'react-easy-crop';
import styles from './company.module.css';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

async function cropImageToFile(params: {
  imageSrc: string;
  cropPixels: Area;
  fileName: string;
  mimeType?: string;
  quality?: number;
  maxSide?: number;
}): Promise<File> {
  const { imageSrc, cropPixels, fileName, mimeType = 'image/png', quality = 0.92, maxSide = 1200 } = params;
  const image = await loadImage(imageSrc);

  const imgW = image.naturalWidth || image.width;
  const imgH = image.naturalHeight || image.height;
  if (!imgW || !imgH) throw new Error('Invalid image dimensions');

  const sx = Math.max(0, Math.floor(cropPixels.x));
  const sy = Math.max(0, Math.floor(cropPixels.y));
  const sWidth = Math.max(1, Math.min(imgW - sx, Math.ceil(cropPixels.width)));
  const sHeight = Math.max(1, Math.min(imgH - sy, Math.ceil(cropPixels.height)));

  const maxInSide = Math.max(sWidth, sHeight);
  const scale = maxInSide > maxSide ? maxSide / maxInSide : 1;
  const outW = Math.max(1, Math.round(sWidth * scale));
  const outH = Math.max(1, Math.round(sHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (mimeType === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
  }

  ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, outW, outH);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error('Failed to export image'));
        resolve(b);
      },
      mimeType,
      quality,
    );
  });

  return new File([blob], fileName, { type: blob.type || mimeType });
}

type Company = {
  id: string;
  name: string;
  profile_completed?: boolean;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  state?: string | null;
  city?: string | null;
  pincode?: string | null;
  gst?: string | null;
  pan?: string | null;
  logo_url?: string | null;
  business_modules?: Partial<BusinessModules> | null;
  documents?: Array<{ name: string; url: string; uploaded_at?: string }> | null;
};

const EMPTY_COMPANY: Company = {
  id: '',
  name: '',
  profile_completed: false,
  address: '',
  phone: '',
  email: '',
  state: '',
  city: '',
  pincode: '',
  gst: '',
  pan: '',
  logo_url: null,
  business_modules: DEFAULT_BUSINESS_MODULES,
  documents: null,
};

const LOCAL_KEY = 'demoCompanySettings';
const BILLING_PREFS_KEY = 'companyBillingPrefs:v1';

type BillingPrefs = {
  gstRegistered: boolean;
};

function safeLoadBillingPrefs(): BillingPrefs | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(BILLING_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BillingPrefs>;
    if (typeof parsed.gstRegistered !== 'boolean') return null;
    return { gstRegistered: parsed.gstRegistered };
  } catch {
    return null;
  }
}

function safeSaveBillingPrefs(prefs: BillingPrefs) {
  try {
    localStorage.setItem(BILLING_PREFS_KEY, JSON.stringify(prefs));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('billingPrefsChanged'));
    }
  } catch {
    // ignore
  }
}

function isAbsoluteUrl(url: string) {
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:');
}

function resolveUrl(url: string) {
  return isAbsoluteUrl(url) ? url : `${API_BASE_URL}${url}`;
}

function safeLoadLocal(): Company | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Company>;
    return { ...EMPTY_COMPANY, ...parsed, business_modules: normalizeBusinessModules(parsed.business_modules) };
  } catch {
    return null;
  }
}

function safeSaveLocal(company: Company) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(company));
  } catch {
    // ignore
  }
}

export default function CompanySettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [company, setCompany] = useState<Company>(EMPTY_COMPANY);
  const [initialCompany, setInitialCompany] = useState<Company>(EMPTY_COMPANY);

  const [cropOpen, setCropOpen] = useState(false);
  const [cropTarget, setCropTarget] = useState<'logo' | 'signature' | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropPixels, setCropPixels] = useState<Area | null>(null);
  const [cropping, setCropping] = useState(false);
  const [cropSize, setCropSize] = useState<Size | null>(null);
  const cropAreaRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<
    | {
        handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
        pointerId: number;
        startX: number;
        startY: number;
        startW: number;
        startH: number;
      }
    | null
  >(null);

  // UI-only fields (kept local so backend payload remains unchanged)
  const [gstRegistered, setGstRegistered] = useState<boolean>(() => {
    const prefs = safeLoadBillingPrefs();
    if (prefs) return prefs.gstRegistered;
    return false;
  });
  const [enableEInvoicing, setEnableEInvoicing] = useState<boolean>(false);
  const [enableTds, setEnableTds] = useState<boolean>(false);
  const [enableTcs, setEnableTcs] = useState<boolean>(false);
  const [websiteDraft, setWebsiteDraft] = useState('');
  const [websites, setWebsites] = useState<string[]>([]);

  const token = useMemo(() => {
    return getAuthToken();
  }, []);

  const modules = normalizeBusinessModules(company.business_modules);

  function setModule(key: keyof BusinessModules, value: boolean) {
    setCompany((c) => {
      const next = normalizeBusinessModules(c.business_modules);
      next[key] = value;

      if (!next.selfStudyLibrary) {
        next.books = false;
        next.lockers = false;
      }

      return { ...c, business_modules: next };
    });
  }

  useEffect(() => {
    (async () => {
      setError(null);
      setSuccess(null);
      try {
        // Frontend-first: if there is no token, load a local demo profile instead of forcing auth.
        if (!token) {
          const local = safeLoadLocal();
          const next = local || EMPTY_COMPANY;
          setCompany(next);
          setInitialCompany(next);
          // If GST preference not explicitly saved, infer from GSTIN.
          const prefs = safeLoadBillingPrefs();
          if (!prefs) setGstRegistered(Boolean((next.gst || '').trim()));
          setLoading(false);
          return;
        }

        const res = await fetch(`${API_BASE_URL}/company`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          // API not reachable? fall back to local demo data.
          const local = safeLoadLocal();
          const next = local || EMPTY_COMPANY;
          setCompany(next);
          setInitialCompany(next);
          const prefs = safeLoadBillingPrefs();
          if (!prefs) setGstRegistered(Boolean((next.gst || '').trim()));
          setLoading(false);
          return;
        }
        const body = (await res.json()) as Company;
        const next = { ...EMPTY_COMPANY, ...body, business_modules: normalizeBusinessModules(body.business_modules) };
        setCompany(next);
        setInitialCompany(next);
        const prefs = safeLoadBillingPrefs();
        if (!prefs) setGstRegistered(Boolean((next.gst || '').trim()));
      } catch {
        const local = safeLoadLocal();
        const next = local || EMPTY_COMPANY;
        setCompany(next);
        setInitialCompany(next);
        const prefs = safeLoadBillingPrefs();
        if (!prefs) setGstRegistered(Boolean((next.gst || '').trim()));
      } finally {
        setLoading(false);
      }
    })();
  }, [router, token]);

  useEffect(() => {
    safeSaveBillingPrefs({ gstRegistered });
  }, [gstRegistered]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (!company?.name?.trim()) {
        setError('Company name is required');
        return;
      }

      // Frontend-only path
      if (!token) {
        safeSaveLocal(company);
        setInitialCompany(company);
        setSuccess('Saved locally (frontend demo).');
        return;
      }

      const res = await fetch(`${API_BASE_URL}/company`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: company.name,
          address: company.address,
          phone: company.phone,
          email: company.email,
          state: company.state,
          city: company.city,
          pincode: company.pincode,
          gst: company.gst,
          pan: company.pan,
          logo_url: company.logo_url,
          business_modules: normalizeBusinessModules(company.business_modules),
          documents: company.documents || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Save failed');

      setSuccess('Saved.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    setError(null);
    setSuccess(null);
    try {
      if (!token) {
        const url = URL.createObjectURL(file);
        setCompany((c) => ({ ...c, logo_url: url }));
        setSuccess('Logo added (local).');
        return;
      }
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE_URL}/company/logo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Logo upload failed');
      setCompany((c) => ({ ...c, logo_url: body.logo_url }));
      setSuccess('Logo uploaded');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Logo upload failed';
      setError(msg);
    } finally {
      setUploadingLogo(false);
    }
  }

  async function uploadSignature(file: File) {
    setUploadingSignature(true);
    setError(null);
    setSuccess(null);
    try {
      if (!token) {
        const url = URL.createObjectURL(file);
        const doc = { name: 'Signature', url };
        setCompany((c) => ({ ...c, documents: [...(c.documents || []), doc] }));
        setSuccess('Signature added (local).');
        return;
      }

      const fd = new FormData();
      fd.append('files', file);
      const res = await fetch(`${API_BASE_URL}/company/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Signature upload failed');

      setCompany((c) => ({ ...c, documents: body.documents }));
      setSuccess('Signature uploaded');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Signature upload failed';
      setError(msg);
    } finally {
      setUploadingSignature(false);
    }
  }

  function startCrop(target: 'logo' | 'signature', file: File) {
    const src = URL.createObjectURL(file);
    setCropTarget(target);
    setCropSrc(src);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCropPixels(null);
    setCropSize(null);
    setCropping(false);
    setCropOpen(true);
    setError(null);
    setSuccess(null);
  }

  function cancelCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropTarget(null);
    setCropSrc(null);
    setCropPixels(null);
    setCrop({ x: 0, y: 0 });
    setCropSize(null);
    setCropping(false);
    setCropOpen(false);
  }

  async function confirmCrop() {
    if (!cropTarget || !cropSrc || !cropPixels) return;
    setCropping(true);
    try {
      const fileName = cropTarget === 'logo' ? 'logo.png' : 'signature.png';
      const outFile = await cropImageToFile({ imageSrc: cropSrc, cropPixels, fileName, mimeType: 'image/png' });

      if (cropTarget === 'logo') {
        await uploadLogo(outFile);
      } else {
        await uploadSignature(outFile);
      }
    } finally {
      cancelCrop();
    }
  }

  useEffect(() => {
    if (!cropOpen || !cropAreaRef.current || cropSize || !cropTarget) return;
    const el = cropAreaRef.current;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;

    // Default to a wide rectangle but allow free resizing.
    const baseW = Math.min(Math.floor(w * 0.78), 520);
    const baseH = Math.min(Math.floor(h * 0.55), cropTarget === 'logo' ? Math.floor(baseW / 4) : Math.floor(baseW / 3));
    const next: Size = {
      width: Math.max(160, Math.min(baseW, w - 24)),
      height: Math.max(80, Math.min(baseH, h - 24)),
    };
    setCropSize(next);
  }, [cropOpen, cropSize, cropTarget]);

  useEffect(() => {
    if (!cropOpen) return;

    const onMove = (e: PointerEvent) => {
      const current = resizeStateRef.current;
      if (!current) return;
      if (e.pointerId !== current.pointerId) return;
      const el = cropAreaRef.current;
      if (!el) return;

      // Prevent scroll/selection while resizing.
      e.preventDefault();

      const maxW = Math.max(200, el.clientWidth - 24);
      const maxH = Math.max(120, el.clientHeight - 24);

      const dx = e.clientX - current.startX;
      const dy = e.clientY - current.startY;

      let nextW = current.startW;
      let nextH = current.startH;

      // Crop area is centered by react-easy-crop, so resize symmetrically.
      if (current.handle.includes('e')) nextW = current.startW + dx * 2;
      if (current.handle.includes('w')) nextW = current.startW - dx * 2;
      if (current.handle.includes('s')) nextH = current.startH + dy * 2;
      if (current.handle.includes('n')) nextH = current.startH - dy * 2;

      nextW = Math.max(160, Math.min(maxW, Math.round(nextW)));
      nextH = Math.max(80, Math.min(maxH, Math.round(nextH)));

      setCropSize({ width: nextW, height: nextH });
    };

    const onUp = (e: PointerEvent) => {
      const current = resizeStateRef.current;
      if (!current) return;
      if (e.pointerId !== current.pointerId) return;
      resizeStateRef.current = null;
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [cropOpen]);

  const cropRectStyle = cropSize
    ? {
        left: `calc(50% - ${cropSize.width / 2}px)`,
        top: `calc(50% - ${cropSize.height / 2}px)`,
        width: `${cropSize.width}px`,
        height: `${cropSize.height}px`,
      }
    : null;

  function startResize(handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw', e: React.PointerEvent) {
    if (!cropSize) return;
    resizeStateRef.current = {
      handle,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startW: cropSize.width,
      startH: cropSize.height,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  async function uploadDocuments(files: FileList) {
    setUploadingDocs(true);
    setError(null);
    setSuccess(null);
    try {
      if (!token) {
        const docs = Array.from(files).map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
        setCompany((c) => ({ ...c, documents: [...(c.documents || []), ...docs] }));
        setSuccess('Documents added (local).');
        return;
      }
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      const res = await fetch(`${API_BASE_URL}/company/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Document upload failed');
      setCompany((c) => ({ ...c, documents: body.documents }));
      setSuccess('Documents uploaded');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Document upload failed';
      setError(msg);
    } finally {
      setUploadingDocs(false);
    }
  }

  return (
    <>
      <TopNav title="Business Settings" />

      <div className={styles.page}>
        <form onSubmit={save} className={styles.form}>
          <div className={styles.stickyHeader}>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => alert('Close financial year is UI-only in this demo.')}
              >
                Close Financial Year
              </button>

              <div className={styles.divider} />

              <button
                type="button"
                className={styles.btnOutline}
                onClick={() => {
                  setCompany(initialCompany);
                  setError(null);
                  setSuccess(null);
                }}
              >
                Cancel
              </button>
              <button className={styles.btnPrimary} type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>

          <div className={styles.canvas}>
            {loading ? <div className={styles.notice}>Loading…</div> : null}
            {!loading && error ? <div className={styles.alertError}>{error}</div> : null}
            {!loading && success ? <div className={styles.alertSuccess}>{success}</div> : null}

            <UniversalModal
              isOpen={cropOpen}
              title={cropTarget === 'signature' ? 'Crop Signature' : 'Crop Logo'}
              onClose={cancelCrop}
              onSubmit={(e) => {
                e.preventDefault();
                void confirmCrop();
              }}
              primaryLabel={cropping ? 'Cropping…' : 'Use Cropped Image'}
              primaryDisabled={cropping || !cropSrc || !cropPixels}
              secondaryLabel="Cancel"
            >
              <div className={styles.cropModalBody}>
                <div className={styles.cropArea}>
                  {cropSrc ? (
                    <>
                      <div ref={cropAreaRef} className={styles.cropStage}>
                        <Cropper
                          image={cropSrc}
                          crop={crop}
                          zoom={zoom}
                          cropSize={cropSize ?? undefined}
                          objectFit="contain"
                          showGrid={false}
                          restrictPosition
                          zoomWithScroll
                          minZoom={0.2}
                          maxZoom={3}
                          onCropChange={setCrop}
                          onZoomChange={setZoom}
                          onCropComplete={(_, areaPixels) => setCropPixels(areaPixels)}
                        />

                        {cropRectStyle ? (
                          <div className={styles.cropHandleLayer} style={cropRectStyle as React.CSSProperties}>
                            <div className={styles.cropHandle} data-pos="nw" onPointerDown={(e) => startResize('nw', e)} />
                            <div className={styles.cropHandle} data-pos="ne" onPointerDown={(e) => startResize('ne', e)} />
                            <div className={styles.cropHandle} data-pos="sw" onPointerDown={(e) => startResize('sw', e)} />
                            <div className={styles.cropHandle} data-pos="se" onPointerDown={(e) => startResize('se', e)} />
                            <div className={styles.cropHandleEdge} data-pos="n" onPointerDown={(e) => startResize('n', e)} />
                            <div className={styles.cropHandleEdge} data-pos="s" onPointerDown={(e) => startResize('s', e)} />
                            <div className={styles.cropHandleEdge} data-pos="w" onPointerDown={(e) => startResize('w', e)} />
                            <div className={styles.cropHandleEdge} data-pos="e" onPointerDown={(e) => startResize('e', e)} />
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>

                <div className={styles.cropControls}>
                  <label className={styles.cropLabel}>Zoom</label>
                  <input
                    className={styles.cropRange}
                    type="range"
                    min={0.2}
                    max={3}
                    step={0.01}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                  />
                </div>

                <div className={styles.muted}>Tip: drag the image to move it. Drag the corners/sides to resize the crop box.</div>
              </div>
            </UniversalModal>

            <div className={styles.layout}>
              {/* LEFT */}
              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <div className={styles.cardTitle}>Company Profile</div>
                    <div className={styles.cardHint}>Basic details used across invoices and reports.</div>
                  </div>
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.logoRow}>
                    <label className={styles.uploadBox}>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploadingLogo}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.currentTarget.value = '';
                          if (f) startCrop('logo', f);
                        }}
                      />
                      <div className={styles.uploadIcon} aria-hidden>
                        ⬆
                      </div>
                      <div className={styles.uploadTitle}>Upload Logo</div>
                      <div className={styles.uploadSub}>PNG/JPG recommended</div>
                    </label>

                    <div className={styles.logoPreview}>
                      <div className={styles.previewTitle}>Preview</div>
                      {company.logo_url ? (
                        <Image
                          className={styles.previewImg}
                          src={resolveUrl(company.logo_url)}
                          alt="Company logo"
                          width={320}
                          height={80}
                          unoptimized
                        />
                      ) : (
                        <div className={styles.previewEmpty}>No logo uploaded</div>
                      )}
                      {uploadingLogo ? <div className={styles.muted}>Uploading…</div> : null}
                    </div>
                  </div>

                  <div className={styles.grid2}>
                    <div className={styles.field}>
                      <label>Business Name *</label>
                      <input
                        value={company.name}
                        onChange={(e) => setCompany((c) => ({ ...c, name: e.target.value }))}
                        placeholder="e.g. Aedify Classes & Library"
                        required
                      />
                    </div>

                    <div className={styles.field}>
                      <label>Company Phone</label>
                      <input
                        value={company.phone || ''}
                        onChange={(e) => setCompany((c) => ({ ...c, phone: e.target.value }))}
                        placeholder="Enter phone number"
                      />
                    </div>
                  </div>

                  <div className={styles.grid2}>
                    <div className={styles.field}>
                      <label>Company E-mail</label>
                      <input
                        value={company.email || ''}
                        onChange={(e) => setCompany((c) => ({ ...c, email: e.target.value }))}
                        placeholder="name@company.com"
                      />
                      <div className={styles.help}>This field is UI-only unless your backend supports it.</div>
                    </div>

                    <div className={styles.field}>
                      <label>Billing Address</label>
                      <input
                        value={company.address || ''}
                        onChange={(e) => setCompany((c) => ({ ...c, address: e.target.value }))}
                        placeholder="Enter billing address"
                      />
                    </div>
                  </div>

                  <div className={styles.grid3}>
                    <div className={styles.field}>
                      <label>State</label>
                      <input
                        value={company.state || ''}
                        onChange={(e) => setCompany((c) => ({ ...c, state: e.target.value }))}
                        placeholder="Enter state"
                      />
                      <div className={styles.help}>UI-only unless your backend supports it.</div>
                    </div>
                    <div className={styles.field}>
                      <label>City</label>
                      <input
                        value={company.city || ''}
                        onChange={(e) => setCompany((c) => ({ ...c, city: e.target.value }))}
                        placeholder="Enter city"
                      />
                    </div>
                    <div className={styles.field}>
                      <label>Pincode</label>
                      <input
                        value={company.pincode || ''}
                        onChange={(e) => setCompany((c) => ({ ...c, pincode: e.target.value }))}
                        placeholder="Enter pincode"
                      />
                    </div>
                  </div>

                  <div className={styles.sectionTitle}>Business Modules</div>
                  <div className={styles.help}>Choose what this institute actually runs. The dashboard and sidebar will only show matching modules.</div>

                  <div className={styles.moduleGrid}>
                    <label className={`${styles.moduleCard} ${modules.selfStudyLibrary ? styles.moduleCardActive : ''}`}>
                      <input
                        type="checkbox"
                        checked={modules.selfStudyLibrary}
                        onChange={(e) => setModule('selfStudyLibrary', e.target.checked)}
                      />
                      <span className={styles.moduleTitle}>Self-study library</span>
                      <span className={styles.moduleHint}>Seats, shifts, admissions, check-ins</span>
                    </label>

                    <label className={`${styles.moduleCard} ${modules.coaching ? styles.moduleCardActive : ''}`}>
                      <input
                        type="checkbox"
                        checked={modules.coaching}
                        onChange={(e) => setModule('coaching', e.target.checked)}
                      />
                      <span className={styles.moduleTitle}>Coaching institute</span>
                      <span className={styles.moduleHint}>Batches, subjects, materials, class fees</span>
                    </label>

                    <label className={`${styles.moduleCard} ${modules.school ? styles.moduleCardActive : ''}`}>
                      <input
                        type="checkbox"
                        checked={modules.school}
                        onChange={(e) => setModule('school', e.target.checked)}
                      />
                      <span className={styles.moduleTitle}>School</span>
                      <span className={styles.moduleHint}>Keep student billing and admin, expand later</span>
                    </label>
                  </div>

                  <div className={styles.moduleGridCompact}>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={modules.books}
                        disabled={!modules.selfStudyLibrary}
                        onChange={(e) => setModule('books', e.target.checked)}
                      />
                      Books issue/return
                    </label>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={modules.lockers}
                        disabled={!modules.selfStudyLibrary}
                        onChange={(e) => setModule('lockers', e.target.checked)}
                      />
                      Lockers
                    </label>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={modules.billing}
                        onChange={(e) => setModule('billing', e.target.checked)}
                      />
                      Billing & receipts
                    </label>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={modules.accounting}
                        onChange={(e) => setModule('accounting', e.target.checked)}
                      />
                      Accounting
                    </label>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={modules.purchases}
                        onChange={(e) => setModule('purchases', e.target.checked)}
                      />
                      Purchases/assets
                    </label>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={modules.reports}
                        onChange={(e) => setModule('reports', e.target.checked)}
                      />
                      Reports
                    </label>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={modules.staff}
                        onChange={(e) => setModule('staff', e.target.checked)}
                      />
                      Staff
                    </label>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={modules.users}
                        onChange={(e) => setModule('users', e.target.checked)}
                      />
                      User admin
                    </label>
                  </div>

                  <div className={styles.sectionTitle}>Tax Details</div>

                  <div className={styles.inlineRow}>
                    <div className={styles.field} style={{ margin: 0 }}>
                      <label>Are you GST registered?</label>
                      <div className={styles.radioRow}>
                        <label className={styles.radioCard}>
                          <input
                            type="radio"
                            name="gstReg"
                            checked={gstRegistered}
                            onChange={() => setGstRegistered(true)}
                          />
                          Yes
                        </label>
                        <label className={styles.radioCard}>
                          <input
                            type="radio"
                            name="gstReg"
                            checked={!gstRegistered}
                            onChange={() => setGstRegistered(false)}
                          />
                          No
                        </label>
                      </div>
                    </div>
                  </div>

                  {gstRegistered ? (
                    <div className={styles.grid2}>
                      <div className={styles.field}>
                        <label>GST Number</label>
                        <input
                          value={company.gst || ''}
                          onChange={(e) => setCompany((c) => ({ ...c, gst: e.target.value }))}
                          placeholder="Enter GSTIN"
                        />
                      </div>
                      <div className={styles.field}>
                        <label>PAN Number</label>
                        <input
                          value={company.pan || ''}
                          onChange={(e) => setCompany((c) => ({ ...c, pan: e.target.value }))}
                          placeholder="Enter PAN"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className={styles.grid2}>
                      <div className={styles.field}>
                        <label>PAN Number</label>
                        <input
                          value={company.pan || ''}
                          onChange={(e) => setCompany((c) => ({ ...c, pan: e.target.value }))}
                          placeholder="Enter PAN"
                        />
                      </div>
                      <div className={styles.field}>
                        <label>GST Number (optional)</label>
                        <input
                          value={company.gst || ''}
                          onChange={(e) => setCompany((c) => ({ ...c, gst: e.target.value }))}
                          placeholder="Enter GSTIN"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* RIGHT */}
              <section className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <div className={styles.cardTitle}>Invoices & Compliance</div>
                    <div className={styles.cardHint}>Optional settings for invoices, attachments, and billing toggles.</div>
                  </div>
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.note}>
                    <strong>Note:</strong> Terms & conditions and signature can be shown on invoices.
                  </div>

                  <div className={styles.sectionTitle}>Signature</div>

                  <label className={styles.uploadBoxWide}>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingSignature}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.currentTarget.value = '';
                        if (f) startCrop('signature', f);
                      }}
                    />
                    <div className={styles.uploadTitle}>+ Add Signature</div>
                    <div className={styles.uploadSub}>Upload an image file</div>
                  </label>

                  {uploadingSignature ? <div className={styles.muted}>Uploading signature…</div> : null}

                  <div className={styles.sectionTitle}>Documents</div>
                  <div className={styles.field}>
                    <label>Attach Documents</label>
                    <input
                      className={styles.fileInline}
                      type="file"
                      multiple
                      disabled={uploadingDocs}
                      onChange={(e) => {
                        const fs = e.target.files;
                        if (fs && fs.length > 0) void uploadDocuments(fs);
                      }}
                    />
                    {uploadingDocs ? <div className={styles.muted}>Uploading…</div> : null}
                  </div>

                  {company.documents && company.documents.length > 0 ? (
                    <ul className={styles.docList}>
                      {company.documents.map((d) => (
                        <li key={d.url}>
                          <a className={styles.link} href={resolveUrl(d.url)} target="_blank" rel="noreferrer">
                            {d.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className={styles.muted}>No documents added yet.</div>
                  )}

                  <div className={styles.sectionTitle}>Additional Details</div>

                  <div className={styles.websiteRow}>
                    <input
                      value={websiteDraft}
                      onChange={(e) => setWebsiteDraft(e.target.value)}
                      placeholder="Website"
                    />
                    <span className={styles.websiteEq}>=</span>
                    <input
                      value={websiteDraft ? `www.${websiteDraft.replace(/^https?:\/\//, '').replace(/^www\./, '')}` : ''}
                      readOnly
                      placeholder="www.website.com"
                    />
                    <button
                      type="button"
                      className={styles.btnPrimarySmall}
                      onClick={() => {
                        const trimmed = websiteDraft.trim();
                        if (!trimmed) return;
                        setWebsites((prev) => (prev.includes(trimmed) ? prev : [trimmed, ...prev]));
                        setWebsiteDraft('');
                      }}
                    >
                      Add
                    </button>
                  </div>

                  {websites.length > 0 ? (
                    <div className={styles.chips}>
                      {websites.map((w) => (
                        <button
                          key={w}
                          type="button"
                          className={styles.chip}
                          onClick={() => setWebsites((prev) => prev.filter((x) => x !== w))}
                          title="Remove"
                        >
                          {w} ×
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className={styles.sectionTitle}>Billing Toggles</div>

                  <div className={styles.toggleRow}>
                    <div>
                      <div className={styles.toggleTitle}>Enable e-Invoicing</div>
                      <div className={styles.help}>UI-only unless integrated with an e-invoicing provider.</div>
                    </div>
                    <button
                      type="button"
                      className={`${styles.toggle} ${enableEInvoicing ? styles.toggleOn : ''}`}
                      onClick={() => setEnableEInvoicing((v) => !v)}
                      aria-pressed={enableEInvoicing}
                    >
                      <span className={styles.knob} />
                    </button>
                  </div>

                  <div className={styles.toggleRow}>
                    <div>
                      <div className={styles.toggleTitle}>Enable TDS</div>
                      <div className={styles.help}>Withholding tax settings for certain payments.</div>
                    </div>
                    <button
                      type="button"
                      className={`${styles.toggle} ${enableTds ? styles.toggleOn : ''}`}
                      onClick={() => setEnableTds((v) => !v)}
                      aria-pressed={enableTds}
                    >
                      <span className={styles.knob} />
                    </button>
                  </div>

                  <div className={styles.toggleRow}>
                    <div>
                      <div className={styles.toggleTitle}>Enable TCS</div>
                      <div className={styles.help}>Tax collected at source for applicable sales.</div>
                    </div>
                    <button
                      type="button"
                      className={`${styles.toggle} ${enableTcs ? styles.toggleOn : ''}`}
                      onClick={() => setEnableTcs((v) => !v)}
                      aria-pressed={enableTcs}
                    >
                      <span className={styles.knob} />
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
