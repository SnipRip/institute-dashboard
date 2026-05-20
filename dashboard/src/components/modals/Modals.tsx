"use client";

import { useEffect, useState } from 'react';
import styles from './Modal.module.css';
import { API_BASE_URL } from '@/lib/api';
import { getAuthToken } from '@/lib/auth';
import Cropper, { type Area } from 'react-easy-crop';
import StudentCombobox from '@/components/ui/StudentCombobox';

// NOTE: This file historically read the auth token from persistent localStorage.
// We now want refresh to keep the session but tab-close to log out, so the token
// must come from sessionStorage. Shadow `localStorage.getItem('token')` locally
// to preserve the existing call sites.
const localStorage = {
    getItem: (key: string): string | null => (key === 'token' ? getAuthToken() : null),
};

const CLASS_THUMBNAIL_VIEWBOX_WIDTH = 300;
const CLASS_THUMBNAIL_VIEWBOX_HEIGHT = 160;

const CLASS_BANNER_VIEWBOX_WIDTH = 600;
const CLASS_BANNER_VIEWBOX_HEIGHT = 260;

const MATERIAL_THUMBNAIL_VIEWBOX_WIDTH = 72;
const MATERIAL_THUMBNAIL_VIEWBOX_HEIGHT = 72;

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = src;
    });
}

async function cropImageToFile(params: {
    imageSrc: string;
    cropPixels: Area;
    outWidth: number;
    outHeight: number;
    fileName: string;
    mimeType?: string;
    quality?: number;
}): Promise<File> {
    const { imageSrc, cropPixels, outWidth, outHeight, fileName, mimeType = 'image/jpeg', quality = 0.9 } = params;
    const image = await loadImage(imageSrc);
    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const imgW = image.naturalWidth || image.width;
    const imgH = image.naturalHeight || image.height;

    const sx = Math.max(0, Math.floor(cropPixels.x));
    const sy = Math.max(0, Math.floor(cropPixels.y));
    const sWidth = Math.max(1, Math.min(imgW - sx, Math.ceil(cropPixels.width)));
    const sHeight = Math.max(1, Math.min(imgH - sy, Math.ceil(cropPixels.height)));

    // Ensure the canvas is fully painted (avoid any unfilled pixel bands)
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outWidth, outHeight);

    ctx.drawImage(
        image,
        sx,
        sy,
        sWidth,
        sHeight,
        0,
        0,
        outWidth,
        outHeight,
    );

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

interface CropImageModalProps {
    isOpen: boolean;
    src: string | null;
    fileName: string;
    title: string;
    outWidth: number;
    outHeight: number;
    aspect: number;
    onClose: () => void;
    onCropped: (file: File) => void;
}

function CropImageModal({ isOpen, src, fileName, title, outWidth, outHeight, aspect, onClose, onCropped }: CropImageModalProps) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [cropPixels, setCropPixels] = useState<Area | null>(null);
    const [saving, setSaving] = useState(false);
    const [objectFit, setObjectFit] = useState<'horizontal-cover' | 'vertical-cover'>('horizontal-cover');

    useEffect(() => {
        if (!isOpen) return;
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCropPixels(null);
        setSaving(false);
        setObjectFit('horizontal-cover');
    }, [isOpen, src]);

    useEffect(() => {
        if (!isOpen || !src) return;
        let cancelled = false;
        void loadImage(src)
            .then((img) => {
                if (cancelled) return;
                const imgW = img.naturalWidth || img.width;
                const imgH = img.naturalHeight || img.height;
                if (!imgW || !imgH) return;
                const imgAspect = imgW / imgH;
                // If the image is wider than the crop box, cover vertically; otherwise cover horizontally.
                setObjectFit(imgAspect > aspect ? 'vertical-cover' : 'horizontal-cover');
            })
            .catch(() => {
                // ignore
            });
        return () => {
            cancelled = true;
        };
    }, [isOpen, src, aspect]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!src || !cropPixels) return;
        setSaving(true);
        try {
            const cropped = await cropImageToFile({
                imageSrc: src,
                cropPixels,
                outWidth,
                outHeight,
                fileName: fileName.replace(/\.[^/.]+$/, '') + '-thumb.jpg',
                mimeType: 'image/jpeg',
                quality: 0.9,
            });
            onCropped(cropped);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            onSubmit={handleSubmit}
            submitDisabled={saving || !src || !cropPixels}
            submitLabel={saving ? 'Cropping...' : 'Use Thumbnail'}
        >
            <div className={styles.inputGroup}>
                <div className={styles.cropArea}>
                    {src ? (
                        <Cropper
                            image={src}
                            crop={crop}
                            zoom={zoom}
                            aspect={aspect}
                            onCropChange={setCrop}
                            onZoomChange={setZoom}
                            onCropComplete={(_, areaPixels) => setCropPixels(areaPixels)}
                            restrictPosition
                            objectFit={objectFit}
                        />
                    ) : null}
                </div>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Zoom</label>
                <div className={styles.cropControls}>
                    <input
                        className={styles.range}
                        type="range"
                        min={1}
                        max={3}
                        step={0.01}
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                    />
                </div>
            </div>

            <div className={styles.inputGroup}>
                <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                    Output: {outWidth}×{outHeight}
                </div>
            </div>
        </BaseModal>
    );
}

interface BaseModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    onSubmit: (e: React.FormEvent) => void;
    submitDisabled?: boolean;
    submitLabel?: string;
}

function BaseModal({ isOpen, onClose, title, children, onSubmit, submitDisabled, submitLabel }: BaseModalProps) {
    if (!isOpen) return null;

    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h2 className={styles.title}>{title}</h2>
                    <button onClick={onClose} className={styles.closeBtn}>&times;</button>
                </div>
                <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
                    <div className={styles.content}>
                        <div className={styles.form}>
                            {children}
                        </div>
                    </div>
                    <div className={styles.footer}>
                        <button type="button" onClick={onClose} className={styles.cancelBtn}>Cancel</button>
                        <button type="submit" className={styles.submitBtn} disabled={!!submitDisabled}>
                            {submitLabel || 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// --- Specific Modals ---

interface AddStudentModalProps {
    isOpen: boolean;
    onClose: () => void;
    availableClasses?: { id: string | number; name: string }[];
    onCreated?: () => void;
}

export function AddStudentModal({ isOpen, onClose, availableClasses = [], onCreated }: AddStudentModalProps) {
    const [admissionType, setAdmissionType] = useState('Library Only');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [alternatePhone, setAlternatePhone] = useState('');
    const [aadhar, setAadhar] = useState('');
    const [guardianName, setGuardianName] = useState('');
    const [address, setAddress] = useState('');
    const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        setSaving(true);
        try {
            if ((admissionType === 'Coaching Only' || admissionType === 'Both') && selectedClassIds.length === 0) {
                throw new Error('Please select at least one class');
            }

            const payload = {
                name,
                phone,
                alternate_phone: alternatePhone || undefined,
                aadhar: aadhar || undefined,
                guardian_name: guardianName || undefined,
                address: address || undefined,
                admission_type: admissionType,
                class_ids: selectedClassIds.length ? selectedClassIds : undefined,
            };

            const res = await fetch(`${API_BASE_URL}/students`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });

            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(body?.message || 'Failed to add student');
            }

            alert('Student Added!');
            onCreated?.();
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Add New Student"
            onSubmit={handleSubmit}
            submitDisabled={saving}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            {/* Student Info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Full Name</label>
                    <input
                        type="text"
                        className={styles.input}
                        placeholder="e.g. Rahul Kumar"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Contact Number</label>
                    <input
                        type="tel"
                        className={styles.input}
                        placeholder="e.g. 9876543210"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                    />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Alternate Contact</label>
                    <input
                        type="tel"
                        className={styles.input}
                        placeholder="Optional"
                        value={alternatePhone}
                        onChange={(e) => setAlternatePhone(e.target.value)}
                    />
                </div>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Unique ID / Adhaar</label>
                    <input
                        type="text"
                        className={styles.input}
                        placeholder="e.g. 1234 5678"
                        value={aadhar}
                        onChange={(e) => setAadhar(e.target.value)}
                    />
                </div>
            </div>

            {/* Parent Info */}
            <div className={styles.inputGroup}>
                <label className={styles.label}>Guardian Name</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="Parent Name"
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                />
            </div>

            {/* Address & Photo */}
            <div className={styles.inputGroup}>
                <label className={styles.label}>Address</label>
                <textarea
                    className={styles.input}
                    rows={2}
                    placeholder="Residential Address..."
                    style={{ resize: 'vertical' }}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Student Photo</label>
                    <input type="file" className={styles.input} accept="image/*" />
                </div>

                <div className={styles.inputGroup}>
                    <label className={styles.label}>Admission Type</label>
                    <select
                        className={styles.select}
                        value={admissionType}
                        onChange={(e) => setAdmissionType(e.target.value)}
                    >
                        <option value="Library Only">Library Only</option>
                        <option value="Coaching Only">Coaching Only</option>
                        <option value="Both">Both</option>
                    </select>
                </div>
            </div>

            {(admissionType === 'Coaching Only' || admissionType === 'Both') && (
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Select Class</label>
                    <select
                        className={styles.select}
                        required
                        multiple
                        value={selectedClassIds}
                        onChange={(e) => {
                            const next = Array.from(e.target.selectedOptions).map((o) => o.value);
                            setSelectedClassIds(next);
                        }}
                    >
                        {availableClasses.length > 0 ? (
                            availableClasses.map((cls) => (
                                <option key={cls.id} value={String(cls.id)}>{cls.name}</option>
                            ))
                        ) : (
                            <option disabled>No classes available</option>
                        )}
                    </select>
                </div>
            )}
        </BaseModal>
    );
}

interface AddBatchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated?: () => void;
}

type WeeklyScheduleEntry = {
    // 0=Mon ... 6=Sun
    day_of_week: number;
    is_off: boolean;
    start_time: string | null;
    end_time: string | null;
};

const WEEK_DAYS: Array<{ day: number; label: string; short: string }> = [
    { day: 0, label: 'Monday', short: 'Mon' },
    { day: 1, label: 'Tuesday', short: 'Tue' },
    { day: 2, label: 'Wednesday', short: 'Wed' },
    { day: 3, label: 'Thursday', short: 'Thu' },
    { day: 4, label: 'Friday', short: 'Fri' },
    { day: 5, label: 'Saturday', short: 'Sat' },
    { day: 6, label: 'Sunday', short: 'Sun' },
];

function createDefaultWeeklySchedule(): WeeklyScheduleEntry[] {
    return WEEK_DAYS.map((d) => ({
        day_of_week: d.day,
        is_off: true,
        start_time: null,
        end_time: null,
    }));
}

function mergeScheduleWithDefaults(fromApi: WeeklyScheduleEntry[] | undefined | null): WeeklyScheduleEntry[] {
    const base = createDefaultWeeklySchedule();
    const map = new Map<number, WeeklyScheduleEntry>();
    for (const e of fromApi ?? []) {
        map.set(e.day_of_week, {
            day_of_week: e.day_of_week,
            is_off: Boolean(e.is_off),
            start_time: e.start_time ?? null,
            end_time: e.end_time ?? null,
        });
    }
    return base
        .map((d) => map.get(d.day_of_week) ?? d)
        .sort((a, b) => a.day_of_week - b.day_of_week);
}

function isScheduleValid(schedule: WeeklyScheduleEntry[]): boolean {
    return schedule.some((e) => {
        if (e.is_off) return false;
        if (!e.start_time || !e.end_time) return false;
        return e.start_time < e.end_time;
    });
}

function normalizeScheduleForSave(schedule: WeeklyScheduleEntry[]): WeeklyScheduleEntry[] {
    return [...schedule]
        .sort((a, b) => a.day_of_week - b.day_of_week)
        .map((e) =>
            e.is_off
                ? { day_of_week: e.day_of_week, is_off: true, start_time: null, end_time: null }
                : {
                    day_of_week: e.day_of_week,
                    is_off: false,
                    start_time: e.start_time ?? null,
                    end_time: e.end_time ?? null,
                },
        );
}

export function AddBatchModal({ isOpen, onClose, onCreated }: AddBatchModalProps) {
    const [name, setName] = useState('');
    const [shortDescription, setShortDescription] = useState('');
    const [weeklySchedule, setWeeklySchedule] = useState<WeeklyScheduleEntry[]>(createDefaultWeeklySchedule());
    const [thumbnail, setThumbnail] = useState<File | null>(null);
    const [cropOpen, setCropOpen] = useState(false);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [cropFileName, setCropFileName] = useState('thumbnail.jpg');
    const [fileInputKey, setFileInputKey] = useState(0);
    const [saving, setSaving] = useState(false);

    const handleClose = () => {
        if (saving) return;
        setName('');
        setShortDescription('');
        setWeeklySchedule(createDefaultWeeklySchedule());
        setThumbnail(null);
        if (cropSrc) URL.revokeObjectURL(cropSrc);
        setCropOpen(false);
        setCropSrc(null);
        setFileInputKey((k) => k + 1);
        onClose();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        const trimmed = name.trim();
        const descTrimmed = shortDescription.trim();
        if (!trimmed) return;
        if (!descTrimmed) return;
        if (!isScheduleValid(weeklySchedule)) return;
        if (!thumbnail) return;

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/classes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    name: trimmed,
                    short_description: descTrimmed,
                    schedule: normalizeScheduleForSave(weeklySchedule),
                }),
            });

            if (!res.ok) {
                const msg = await res.text().catch(() => '');
                alert(msg || 'Failed to create class');
                return;
            }

            const created = await res.json().catch(() => null);
            const createdId = created?.id as string | undefined;
            if (!createdId) {
                alert('Class created, but response was invalid');
                return;
            }

            const fd = new FormData();
            fd.append('thumbnail', thumbnail);
            const uploadRes = await fetch(`${API_BASE_URL}/classes/${createdId}/thumbnail`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: fd,
            });

            if (!uploadRes.ok) {
                const msg = await uploadRes.text().catch(() => '');
                alert(msg || 'Failed to upload thumbnail');
                return;
            }

            setName('');
            setShortDescription('');
            setWeeklySchedule(createDefaultWeeklySchedule());
            setThumbnail(null);
            setFileInputKey((k) => k + 1);
            onClose();
            onCreated?.();
        } catch {
            alert('Failed to create class');
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={handleClose}
            title="Create New Class"
            onSubmit={handleSubmit}
            submitDisabled={
                saving ||
                !name.trim() ||
                !shortDescription.trim() ||
                !isScheduleValid(weeklySchedule) ||
                !thumbnail
            }
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Class Name</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Class 6"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Short Description</label>
                <textarea
                    className={styles.input}
                    rows={2}
                    placeholder="e.g. Foundation batch for Class 6 students"
                    required
                    value={shortDescription}
                    onChange={(e) => setShortDescription(e.target.value)}
                    style={{ resize: 'vertical' }}
                />
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Weekly Schedule</label>
                <div className={styles.scheduleTable}>
                    {WEEK_DAYS.map((d) => {
                        const entry = weeklySchedule.find((e) => e.day_of_week === d.day) ?? {
                            day_of_week: d.day,
                            is_off: true,
                            start_time: null,
                            end_time: null,
                        };

                        return (
                            <div key={d.day} className={styles.scheduleRow}>
                                <div className={styles.scheduleDay}>{d.label}</div>

                                <div className={styles.scheduleTimes}>
                                    <input
                                        type="time"
                                        className={styles.input}
                                        value={entry.start_time ?? ''}
                                        disabled={entry.is_off}
                                        onChange={(e) => {
                                            const next = weeklySchedule.map((x) =>
                                                x.day_of_week === d.day
                                                    ? { ...x, is_off: false, start_time: e.target.value || null }
                                                    : x,
                                            );
                                            setWeeklySchedule(next);
                                        }}
                                    />
                                    <span className={styles.scheduleDash}>–</span>
                                    <input
                                        type="time"
                                        className={styles.input}
                                        value={entry.end_time ?? ''}
                                        disabled={entry.is_off}
                                        onChange={(e) => {
                                            const next = weeklySchedule.map((x) =>
                                                x.day_of_week === d.day
                                                    ? { ...x, is_off: false, end_time: e.target.value || null }
                                                    : x,
                                            );
                                            setWeeklySchedule(next);
                                        }}
                                    />
                                </div>

                                <label className={styles.scheduleOff}>
                                    <input
                                        type="checkbox"
                                        checked={entry.is_off}
                                        onChange={(e) => {
                                            const isOff = e.target.checked;
                                            const next = weeklySchedule.map((x) =>
                                                x.day_of_week === d.day
                                                    ? {
                                                        ...x,
                                                        is_off: isOff,
                                                        start_time: isOff ? null : x.start_time,
                                                        end_time: isOff ? null : x.end_time,
                                                    }
                                                    : x,
                                            );
                                            setWeeklySchedule(next);
                                        }}
                                    />
                                    Off
                                </label>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Thumbnail</label>
                <input
                    key={fileInputKey}
                    type="file"
                    className={styles.input}
                    accept="image/*"
                    required
                    onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        if (!file) {
                            setThumbnail(null);
                            return;
                        }
                        if (cropSrc) URL.revokeObjectURL(cropSrc);
                        const url = URL.createObjectURL(file);
                        setCropFileName(file.name || 'thumbnail.jpg');
                        setCropSrc(url);
                        setCropOpen(true);
                    }}
                />
            </div>

            <CropImageModal
                isOpen={cropOpen}
                src={cropSrc}
                fileName={cropFileName}
                title="Crop Thumbnail"
                outWidth={CLASS_THUMBNAIL_VIEWBOX_WIDTH}
                outHeight={CLASS_THUMBNAIL_VIEWBOX_HEIGHT}
                aspect={CLASS_THUMBNAIL_VIEWBOX_WIDTH / CLASS_THUMBNAIL_VIEWBOX_HEIGHT}
                onClose={() => {
                    if (cropSrc) URL.revokeObjectURL(cropSrc);
                    setCropOpen(false);
                    setCropSrc(null);
                    setThumbnail(null);
                    setFileInputKey((k) => k + 1);
                }}
                onCropped={(file) => {
                    if (cropSrc) URL.revokeObjectURL(cropSrc);
                    setThumbnail(file);
                    setCropOpen(false);
                    setCropSrc(null);
                }}
            />
        </BaseModal>
    );
}

interface EditClassModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    defaultName: string;
    defaultMonthlyFee?: number | null;
    defaultShortDescription?: string | null;
    defaultSchedule?: WeeklyScheduleEntry[] | null;
    onSaved?: () => void;
}

export function EditClassModal({
    isOpen,
    onClose,
    classId,
    defaultName,
    defaultMonthlyFee,
    defaultShortDescription,
    defaultSchedule,
    onSaved,
}: EditClassModalProps) {
    const [name, setName] = useState(defaultName);
    const [monthlyFee, setMonthlyFee] = useState<number>(typeof defaultMonthlyFee === 'number' ? defaultMonthlyFee : 0);
    const [shortDescription, setShortDescription] = useState(defaultShortDescription ?? '');
    const [weeklySchedule, setWeeklySchedule] = useState<WeeklyScheduleEntry[]>(mergeScheduleWithDefaults(defaultSchedule ?? undefined));
    const [thumbnail, setThumbnail] = useState<File | null>(null);
    const [cropOpen, setCropOpen] = useState(false);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [cropFileName, setCropFileName] = useState('thumbnail.jpg');
    const [fileInputKey, setFileInputKey] = useState(0);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setName(defaultName);
        setMonthlyFee(typeof defaultMonthlyFee === 'number' ? defaultMonthlyFee : 0);
        setShortDescription(defaultShortDescription ?? '');
        setWeeklySchedule(mergeScheduleWithDefaults(defaultSchedule ?? undefined));
        setThumbnail(null);
        setCropOpen(false);
        setCropSrc((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
        setFileInputKey((k) => k + 1);
    }, [isOpen, defaultName, defaultMonthlyFee, defaultShortDescription, defaultSchedule]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        const trimmed = name.trim();
        const descTrimmed = shortDescription.trim();
        if (!trimmed || !descTrimmed) return;
        if (!isScheduleValid(weeklySchedule)) return;

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/classes/${classId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    name: trimmed,
                    monthly_fee: Number.isFinite(monthlyFee) ? monthlyFee : 0,
                    short_description: descTrimmed,
                    schedule: normalizeScheduleForSave(weeklySchedule),
                }),
            });

            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(body?.message || 'Failed to save class');
            }

            if (thumbnail) {
                const fd = new FormData();
                fd.append('thumbnail', thumbnail);
                const uploadRes = await fetch(`${API_BASE_URL}/classes/${classId}/thumbnail`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    body: fd,
                });

                if (!uploadRes.ok) {
                    const msg = await uploadRes.text().catch(() => '');
                    throw new Error(msg || 'Failed to upload thumbnail');
                }
            }

            onSaved?.();
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Class Settings"
            onSubmit={handleSubmit}
            submitDisabled={saving || !name.trim() || !shortDescription.trim() || !isScheduleValid(weeklySchedule)}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Class Name</label>
                <input
                    type="text"
                    className={styles.input}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Monthly Fee (₹)</label>
                <input
                    type="number"
                    className={styles.input}
                    min={0}
                    value={monthlyFee}
                    onChange={(e) => setMonthlyFee(parseInt(e.target.value || '0', 10) || 0)}
                />
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Short Description</label>
                <textarea
                    className={styles.input}
                    rows={2}
                    required
                    value={shortDescription}
                    onChange={(e) => setShortDescription(e.target.value)}
                    style={{ resize: 'vertical' }}
                />
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Weekly Schedule</label>
                <div className={styles.scheduleTable}>
                    {WEEK_DAYS.map((d) => {
                        const entry = weeklySchedule.find((e) => e.day_of_week === d.day) ?? {
                            day_of_week: d.day,
                            is_off: true,
                            start_time: null,
                            end_time: null,
                        };

                        return (
                            <div key={d.day} className={styles.scheduleRow}>
                                <div className={styles.scheduleDay}>{d.label}</div>

                                <div className={styles.scheduleTimes}>
                                    <input
                                        type="time"
                                        className={styles.input}
                                        value={entry.start_time ?? ''}
                                        disabled={entry.is_off}
                                        onChange={(e) => {
                                            const next = weeklySchedule.map((x) =>
                                                x.day_of_week === d.day
                                                    ? { ...x, is_off: false, start_time: e.target.value || null }
                                                    : x,
                                            );
                                            setWeeklySchedule(next);
                                        }}
                                    />
                                    <span className={styles.scheduleDash}>–</span>
                                    <input
                                        type="time"
                                        className={styles.input}
                                        value={entry.end_time ?? ''}
                                        disabled={entry.is_off}
                                        onChange={(e) => {
                                            const next = weeklySchedule.map((x) =>
                                                x.day_of_week === d.day
                                                    ? { ...x, is_off: false, end_time: e.target.value || null }
                                                    : x,
                                            );
                                            setWeeklySchedule(next);
                                        }}
                                    />
                                </div>

                                <label className={styles.scheduleOff}>
                                    <input
                                        type="checkbox"
                                        checked={entry.is_off}
                                        onChange={(e) => {
                                            const isOff = e.target.checked;
                                            const next = weeklySchedule.map((x) =>
                                                x.day_of_week === d.day
                                                    ? {
                                                        ...x,
                                                        is_off: isOff,
                                                        start_time: isOff ? null : x.start_time,
                                                        end_time: isOff ? null : x.end_time,
                                                    }
                                                    : x,
                                            );
                                            setWeeklySchedule(next);
                                        }}
                                    />
                                    Off
                                </label>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Update Thumbnail (optional)</label>
                <input
                    key={fileInputKey}
                    type="file"
                    className={styles.input}
                    accept="image/*"
                    onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        if (!file) {
                            setThumbnail(null);
                            return;
                        }
                        if (cropSrc) URL.revokeObjectURL(cropSrc);
                        const url = URL.createObjectURL(file);
                        setCropFileName(file.name || 'thumbnail.jpg');
                        setCropSrc(url);
                        setCropOpen(true);
                    }}
                />
            </div>

            <CropImageModal
                isOpen={cropOpen}
                src={cropSrc}
                fileName={cropFileName}
                title="Crop Thumbnail"
                outWidth={CLASS_THUMBNAIL_VIEWBOX_WIDTH}
                outHeight={CLASS_THUMBNAIL_VIEWBOX_HEIGHT}
                aspect={CLASS_THUMBNAIL_VIEWBOX_WIDTH / CLASS_THUMBNAIL_VIEWBOX_HEIGHT}
                onClose={() => {
                    if (cropSrc) URL.revokeObjectURL(cropSrc);
                    setCropOpen(false);
                    setCropSrc(null);
                    setThumbnail(null);
                    setFileInputKey((k) => k + 1);
                }}
                onCropped={(file) => {
                    if (cropSrc) URL.revokeObjectURL(cropSrc);
                    setThumbnail(file);
                    setCropOpen(false);
                    setCropSrc(null);
                }}
            />
        </BaseModal>
    );
}

interface EditClassNameModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    defaultName: string;
    onSaved?: () => void;
}

export function EditClassNameModal({
    isOpen,
    onClose,
    classId,
    defaultName,
    onSaved,
}: EditClassNameModalProps) {
    const [name, setName] = useState(defaultName);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setName(defaultName);
    }, [isOpen, defaultName]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        const trimmed = name.trim();
        if (!trimmed) return;

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/classes/${classId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ name: trimmed }),
            });

            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error((body as { message?: string })?.message || 'Failed to save class name');
            }

            onSaved?.();
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit Class Name"
            onSubmit={handleSubmit}
            submitDisabled={saving || !name.trim()}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Class Name</label>
                <input
                    type="text"
                    className={styles.input}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>
        </BaseModal>
    );
}

interface EditClassDescriptionModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    defaultShortDescription?: string | null;
    onSaved?: () => void;
}

export function EditClassDescriptionModal({
    isOpen,
    onClose,
    classId,
    defaultShortDescription,
    onSaved,
}: EditClassDescriptionModalProps) {
    const [shortDescription, setShortDescription] = useState(defaultShortDescription ?? '');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setShortDescription(defaultShortDescription ?? '');
    }, [isOpen, defaultShortDescription]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        const trimmed = shortDescription.trim();
        if (!trimmed) return;

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/classes/${classId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ short_description: trimmed }),
            });

            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error((body as { message?: string })?.message || 'Failed to save short description');
            }

            onSaved?.();
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit Short Description"
            onSubmit={handleSubmit}
            submitDisabled={saving || !shortDescription.trim()}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Short Description</label>
                <textarea
                    className={styles.input}
                    rows={2}
                    required
                    value={shortDescription}
                    onChange={(e) => setShortDescription(e.target.value)}
                    style={{ resize: 'vertical' }}
                />
            </div>
        </BaseModal>
    );
}

interface EditClassScheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    defaultSchedule?: WeeklyScheduleEntry[] | null;
    onSaved?: () => void;
}

export function EditClassScheduleModal({
    isOpen,
    onClose,
    classId,
    defaultSchedule,
    onSaved,
}: EditClassScheduleModalProps) {
    const [weeklySchedule, setWeeklySchedule] = useState<WeeklyScheduleEntry[]>(mergeScheduleWithDefaults(defaultSchedule ?? undefined));
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setWeeklySchedule(mergeScheduleWithDefaults(defaultSchedule ?? undefined));
    }, [isOpen, defaultSchedule]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        if (!isScheduleValid(weeklySchedule)) return;

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/classes/${classId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ schedule: normalizeScheduleForSave(weeklySchedule) }),
            });

            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error((body as { message?: string })?.message || 'Failed to save schedule');
            }

            onSaved?.();
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit Schedule"
            onSubmit={handleSubmit}
            submitDisabled={saving || !isScheduleValid(weeklySchedule)}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Weekly Schedule</label>
                <div className={styles.scheduleTable}>
                    {WEEK_DAYS.map((d) => {
                        const entry = weeklySchedule.find((e) => e.day_of_week === d.day) ?? {
                            day_of_week: d.day,
                            is_off: true,
                            start_time: null,
                            end_time: null,
                        };

                        return (
                            <div key={d.day} className={styles.scheduleRow}>
                                <div className={styles.scheduleDay}>{d.label}</div>

                                <div className={styles.scheduleTimes}>
                                    <input
                                        type="time"
                                        className={styles.input}
                                        value={entry.start_time ?? ''}
                                        disabled={entry.is_off}
                                        onChange={(e) => {
                                            const next = weeklySchedule.map((x) =>
                                                x.day_of_week === d.day
                                                    ? { ...x, is_off: false, start_time: e.target.value || null }
                                                    : x,
                                            );
                                            setWeeklySchedule(next);
                                        }}
                                    />
                                    <span className={styles.scheduleDash}>–</span>
                                    <input
                                        type="time"
                                        className={styles.input}
                                        value={entry.end_time ?? ''}
                                        disabled={entry.is_off}
                                        onChange={(e) => {
                                            const next = weeklySchedule.map((x) =>
                                                x.day_of_week === d.day
                                                    ? { ...x, is_off: false, end_time: e.target.value || null }
                                                    : x,
                                            );
                                            setWeeklySchedule(next);
                                        }}
                                    />
                                </div>

                                <label className={styles.scheduleOff}>
                                    <input
                                        type="checkbox"
                                        checked={entry.is_off}
                                        onChange={(e) => {
                                            const isOff = e.target.checked;
                                            const next = weeklySchedule.map((x) =>
                                                x.day_of_week === d.day
                                                    ? {
                                                        ...x,
                                                        is_off: isOff,
                                                        start_time: isOff ? null : x.start_time,
                                                        end_time: isOff ? null : x.end_time,
                                                    }
                                                    : x,
                                            );
                                            setWeeklySchedule(next);
                                        }}
                                    />
                                    Off
                                </label>
                            </div>
                        );
                    })}
                </div>
            </div>
        </BaseModal>
    );
}

interface EditClassThumbnailModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    onSaved?: () => void;
}

export function EditClassCardThumbnailModal({
    isOpen,
    onClose,
    classId,
    onSaved,
}: EditClassThumbnailModalProps) {
    const [thumbnail, setThumbnail] = useState<File | null>(null);
    const [cropOpen, setCropOpen] = useState(false);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [cropFileName, setCropFileName] = useState('thumbnail.jpg');
    const [fileInputKey, setFileInputKey] = useState(0);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setThumbnail(null);
        setCropOpen(false);
        setCropSrc((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
        setFileInputKey((k) => k + 1);
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        if (!thumbnail) return;

        setSaving(true);
        try {
            const fd = new FormData();
            fd.append('thumbnail', thumbnail);
            const uploadRes = await fetch(`${API_BASE_URL}/classes/${classId}/thumbnail`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: fd,
            });

            if (!uploadRes.ok) {
                const msg = await uploadRes.text().catch(() => '');
                throw new Error(msg || 'Failed to upload thumbnail');
            }

            onSaved?.();
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Update Card Thumbnail"
            onSubmit={handleSubmit}
            submitDisabled={saving || !thumbnail}
            submitLabel={saving ? 'Uploading...' : 'Upload'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Card Thumbnail</label>
                <input
                    key={fileInputKey}
                    type="file"
                    className={styles.input}
                    accept="image/*"
                    required
                    onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        if (!file) {
                            setThumbnail(null);
                            return;
                        }
                        if (cropSrc) URL.revokeObjectURL(cropSrc);
                        const url = URL.createObjectURL(file);
                        setCropFileName(file.name || 'thumbnail.jpg');
                        setCropSrc(url);
                        setCropOpen(true);
                    }}
                />
            </div>

            <CropImageModal
                isOpen={cropOpen}
                src={cropSrc}
                fileName={cropFileName}
                title="Crop Card Thumbnail"
                outWidth={CLASS_THUMBNAIL_VIEWBOX_WIDTH}
                outHeight={CLASS_THUMBNAIL_VIEWBOX_HEIGHT}
                aspect={CLASS_THUMBNAIL_VIEWBOX_WIDTH / CLASS_THUMBNAIL_VIEWBOX_HEIGHT}
                onClose={() => {
                    if (cropSrc) URL.revokeObjectURL(cropSrc);
                    setCropOpen(false);
                    setCropSrc(null);
                    setThumbnail(null);
                    setFileInputKey((k) => k + 1);
                }}
                onCropped={(file) => {
                    if (cropSrc) URL.revokeObjectURL(cropSrc);
                    setThumbnail(file);
                    setCropOpen(false);
                    setCropSrc(null);
                }}
            />
        </BaseModal>
    );
}

export function EditClassBannerModal({
    isOpen,
    onClose,
    classId,
    onSaved,
}: EditClassThumbnailModalProps) {
    const [thumbnail, setThumbnail] = useState<File | null>(null);
    const [cropOpen, setCropOpen] = useState(false);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [cropFileName, setCropFileName] = useState('thumbnail.jpg');
    const [fileInputKey, setFileInputKey] = useState(0);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setThumbnail(null);
        setCropOpen(false);
        setCropSrc((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
        setFileInputKey((k) => k + 1);
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        if (!thumbnail) return;

        setSaving(true);
        try {
            const fd = new FormData();
            fd.append('banner', thumbnail);
            const uploadRes = await fetch(`${API_BASE_URL}/classes/${classId}/banner`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: fd,
            });

            if (!uploadRes.ok) {
                const msg = await uploadRes.text().catch(() => '');
                throw new Error(msg || 'Failed to upload banner');
            }

            onSaved?.();
            onClose();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Update Banner"
            onSubmit={handleSubmit}
            submitDisabled={saving || !thumbnail}
            submitLabel={saving ? 'Uploading...' : 'Upload'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Banner Image</label>
                <input
                    key={fileInputKey}
                    type="file"
                    className={styles.input}
                    accept="image/*"
                    required
                    onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        if (!file) {
                            setThumbnail(null);
                            return;
                        }
                        if (cropSrc) URL.revokeObjectURL(cropSrc);
                        const url = URL.createObjectURL(file);
                        setCropFileName(file.name || 'thumbnail.jpg');
                        setCropSrc(url);
                        setCropOpen(true);
                    }}
                />
            </div>

            <CropImageModal
                isOpen={cropOpen}
                src={cropSrc}
                fileName={cropFileName}
                title="Crop Banner"
                outWidth={CLASS_BANNER_VIEWBOX_WIDTH}
                outHeight={CLASS_BANNER_VIEWBOX_HEIGHT}
                aspect={CLASS_BANNER_VIEWBOX_WIDTH / CLASS_BANNER_VIEWBOX_HEIGHT}
                onClose={() => {
                    if (cropSrc) URL.revokeObjectURL(cropSrc);
                    setCropOpen(false);
                    setCropSrc(null);
                    setThumbnail(null);
                    setFileInputKey((k) => k + 1);
                }}
                onCropped={(file) => {
                    if (cropSrc) URL.revokeObjectURL(cropSrc);
                    setThumbnail(file);
                    setCropOpen(false);
                    setCropSrc(null);
                }}
            />
        </BaseModal>
    );
}

interface AddUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    branches?: Array<{ id: string; name: string }>;
    roles?: Array<{ id: string; name: string }>;
    onCreate: (payload: {
        username: string;
        email: string;
        default_password: string;
        original_name: string;
        first_name: string;
        last_name: string;
        address: string;
        phone: string;
        alternate_phone: string;
        pan: string;
        aadhar: string;
        documents: Array<{ name: string; type: string; size: number; lastModified: number }>;
        role: string;
        branch_access?: Array<{ branch_id: string; role_id: string; is_active: boolean }>;
    }) => void;
}

export function AddUserModal({ isOpen, onClose, onCreate, branches = [], roles = [] }: AddUserModalProps) {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [defaultPassword, setDefaultPassword] = useState('');
    const [originalName, setOriginalName] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [address, setAddress] = useState('');
    const [phone, setPhone] = useState('');
    const [alternatePhone, setAlternatePhone] = useState('');
    const [pan, setPan] = useState('');
    const [aadhar, setAadhar] = useState('');
    const [role, setRole] = useState('user');
    const [branchAccess, setBranchAccess] = useState<Record<string, { enabled: boolean; role_id: string }>>({});
    const [files, setFiles] = useState<File[]>([]);
    const [fileInputKey, setFileInputKey] = useState(0);

    const resetForm = () => {
        setUsername('');
        setEmail('');
        setDefaultPassword('');
        setOriginalName('');
        setFirstName('');
        setLastName('');
        setAddress('');
        setPhone('');
        setAlternatePhone('');
        setPan('');
        setAadhar('');
        setRole('user');
        setBranchAccess({});
        setFiles([]);
        setFileInputKey((k) => k + 1);
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const u = username.trim();
        const em = email.trim();
        const pwd = defaultPassword;

        if (!u || !em || !pwd) {
            alert('Username, Email and Default Password are required');
            return;
        }

        onCreate({
            username: u,
            email: em,
            default_password: pwd,
            original_name: originalName.trim(),
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            address: address.trim(),
            phone: phone.trim(),
            alternate_phone: alternatePhone.trim(),
            pan: pan.trim(),
            aadhar: aadhar.trim(),
            documents: files.map((f) => ({
                name: f.name,
                type: f.type || 'application/octet-stream',
                size: f.size,
                lastModified: f.lastModified,
            })),
            role,
            branch_access: Object.entries(branchAccess)
                .filter(([, v]) => v.enabled && v.role_id)
                .map(([branch_id, v]) => ({ branch_id, role_id: v.role_id, is_active: true })),
        });

        resetForm();
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={handleClose}
            title="Add New User"
            onSubmit={handleSubmit}
            submitLabel="Create User"
        >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Username *</label>
                    <input
                        type="text"
                        className={styles.input}
                        placeholder="e.g. staff01"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                </div>

                <div className={styles.inputGroup}>
                    <label className={styles.label}>Email *</label>
                    <input
                        type="email"
                        className={styles.input}
                        placeholder="e.g. staff@school.edu"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Default Password *</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="Provide default password"
                    required
                    value={defaultPassword}
                    onChange={(e) => setDefaultPassword(e.target.value)}
                />
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Original Name</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="Name as on documents"
                    value={originalName}
                    onChange={(e) => setOriginalName(e.target.value)}
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>First Name</label>
                    <input
                        type="text"
                        className={styles.input}
                        placeholder="First name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                    />
                </div>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Last Name</label>
                    <input
                        type="text"
                        className={styles.input}
                        placeholder="Last name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                    />
                </div>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Address</label>
                <textarea
                    className={styles.textarea}
                    placeholder="Address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={3}
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Phone Number</label>
                    <input
                        type="tel"
                        className={styles.input}
                        placeholder="e.g. 9876543210"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                    />
                </div>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Alternate Number</label>
                    <input
                        type="tel"
                        className={styles.input}
                        placeholder="Optional"
                        value={alternatePhone}
                        onChange={(e) => setAlternatePhone(e.target.value)}
                    />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>PAN No.</label>
                    <input
                        type="text"
                        className={styles.input}
                        placeholder="e.g. ABCDE1234F"
                        value={pan}
                        onChange={(e) => setPan(e.target.value)}
                    />
                </div>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Aadhaar No.</label>
                    <input
                        type="text"
                        className={styles.input}
                        placeholder="e.g. 1234 5678 9012"
                        value={aadhar}
                        onChange={(e) => setAadhar(e.target.value)}
                    />
                </div>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Attachments (multiple)</label>
                <input
                    key={fileInputKey}
                    type="file"
                    multiple
                    className={styles.input}
                    onChange={(e) => setFiles(Array.from(e.target.files || []))}
                />
                {files.length > 0 ? (
                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                        Selected: {files.map((f) => f.name).join(', ')}
                    </div>
                ) : null}
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Role</label>
                <select className={styles.select} value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                    <option value="owner">owner</option>
                </select>
            </div>

            {branches.length > 0 && roles.length > 0 ? (
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Branch Access</label>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                        {branches.map((branch) => {
                            const current = branchAccess[branch.id] || { enabled: false, role_id: roles.find((r) => r.name === role)?.id || roles[0]?.id || '' };
                            return (
                                <div key={branch.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 180px', gap: '0.5rem', alignItems: 'center' }}>
                                    <input
                                        type="checkbox"
                                        checked={current.enabled}
                                        onChange={(e) => setBranchAccess((prev) => ({
                                            ...prev,
                                            [branch.id]: { ...current, enabled: e.target.checked },
                                        }))}
                                    />
                                    <span>{branch.name}</span>
                                    <select
                                        className={styles.select}
                                        value={current.role_id}
                                        disabled={!current.enabled}
                                        onChange={(e) => setBranchAccess((prev) => ({
                                            ...prev,
                                            [branch.id]: { ...current, role_id: e.target.value },
                                        }))}
                                    >
                                        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </BaseModal>
    );
}

interface EditUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    user: {
        id: string;
        username: string;
        email: string;
        role: string;
        is_active?: boolean;
        original_name?: string;
        first_name?: string;
        last_name?: string;
        address?: string;
        phone?: string;
        alternate_phone?: string;
        pan?: string;
        aadhar?: string;
        documents?: Array<{ name: string; type: string; size: number; lastModified: number }>;
        branch_access?: Array<{ branch_id: string; role_id: string; is_active: boolean }>;
        created_at?: string;
    } | null;
    branches?: Array<{ id: string; name: string }>;
    roles?: Array<{ id: string; name: string }>;
    onSave: (payload: {
        id: string;
        username: string;
        email: string;
        role: string;
        is_active: boolean;
        original_name: string;
        first_name: string;
        last_name: string;
        address: string;
        phone: string;
        alternate_phone: string;
        pan: string;
        aadhar: string;
        documents: Array<{ name: string; type: string; size: number; lastModified: number }>;
        branch_access?: Array<{ branch_id: string; role_id: string; is_active: boolean }>;
    }) => void;
    saving?: boolean;
    disableDeactivate?: boolean;
    disableDeactivateReason?: string;
    disableMakeInactiveBecauseLastAdmin?: boolean;

    showDelete?: boolean;
    deleting?: boolean;
    disableDelete?: boolean;
    disableDeleteReason?: string;
    onDelete?: (id: string) => void;
}

export function EditUserModal({
    isOpen,
    onClose,
    user,
    onSave,
    saving,
    disableDeactivate,
    disableDeactivateReason,
    disableMakeInactiveBecauseLastAdmin,
    showDelete,
    deleting,
    disableDelete,
    disableDeleteReason,
    onDelete,
    branches = [],
    roles = [],
}: EditUserModalProps) {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [originalName, setOriginalName] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [address, setAddress] = useState('');
    const [phone, setPhone] = useState('');
    const [alternatePhone, setAlternatePhone] = useState('');
    const [pan, setPan] = useState('');
    const [aadhar, setAadhar] = useState('');
    const [role, setRole] = useState('user');
    const [isActive, setIsActive] = useState(true);
    const [branchAccess, setBranchAccess] = useState<Record<string, { enabled: boolean; role_id: string }>>({});

    useEffect(() => {
        if (!isOpen || !user) return;
        setUsername(user.username || '');
        setEmail(user.email || '');
        setOriginalName(user.original_name || '');
        setFirstName(user.first_name || '');
        setLastName(user.last_name || '');
        setAddress(user.address || '');
        setPhone(user.phone || '');
        setAlternatePhone(user.alternate_phone || '');
        setPan(user.pan || '');
        setAadhar(user.aadhar || '');
        setRole(user.role || 'user');
        setIsActive(user.is_active !== false);
        const next: Record<string, { enabled: boolean; role_id: string }> = {};
        for (const access of user.branch_access || []) {
            next[access.branch_id] = { enabled: access.is_active !== false, role_id: access.role_id };
        }
        setBranchAccess(next);
    }, [isOpen, user]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        const u = username.trim();
        const em = email.trim();
        if (!u || !em) {
            alert('Username and Email are required');
            return;
        }

        onSave({
            id: user.id,
            username: u,
            email: em,
            role,
            is_active: isActive,
            original_name: originalName.trim(),
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            address: address.trim(),
            phone: phone.trim(),
            alternate_phone: alternatePhone.trim(),
            pan: pan.trim(),
            aadhar: aadhar.trim(),
            documents: Array.isArray(user.documents) ? user.documents : [],
            branch_access: Object.entries(branchAccess)
                .filter(([, v]) => v.enabled && v.role_id)
                .map(([branch_id, v]) => ({ branch_id, role_id: v.role_id, is_active: true })),
        });
    };

    const canRenderDelete = !!showDelete && !!user && typeof onDelete === 'function';

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit User"
            onSubmit={handleSubmit}
            submitLabel={saving ? 'Saving…' : 'Save Changes'}
            submitDisabled={!!saving || !user}
        >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Username *</label>
                    <input
                        type="text"
                        className={styles.input}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                    />
                </div>

                <div className={styles.inputGroup}>
                    <label className={styles.label}>Email *</label>
                    <input
                        type="email"
                        className={styles.input}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Password</label>
                    <input type="password" className={styles.input} value="********" disabled />
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 6 }}>
                        Password can’t be edited from here.
                    </div>
                </div>

                <div className={styles.inputGroup}>
                    <label className={styles.label}>Status</label>
                    <select className={styles.select} value={isActive ? 'active' : 'inactive'} onChange={(e) => setIsActive(e.target.value === 'active')}>
                        <option value="active">active</option>
                        <option value="inactive" disabled={!!disableDeactivate || !!disableMakeInactiveBecauseLastAdmin}>inactive</option>
                    </select>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 6 }}>
                        Inactive users cannot log in.
                    </div>
                    {disableDeactivateReason ? (
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 6 }}>
                            {disableDeactivateReason}
                        </div>
                    ) : null}
                    {disableMakeInactiveBecauseLastAdmin ? (
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 6 }}>
                            At least one active admin/owner must remain.
                        </div>
                    ) : null}
                </div>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Original Name</label>
                <input type="text" className={styles.input} value={originalName} onChange={(e) => setOriginalName(e.target.value)} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>First Name</label>
                    <input type="text" className={styles.input} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Last Name</label>
                    <input type="text" className={styles.input} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Address</label>
                <textarea className={styles.textarea} value={address} onChange={(e) => setAddress(e.target.value)} rows={3} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Phone Number</label>
                    <input type="tel" className={styles.input} value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Alternate Number</label>
                    <input type="tel" className={styles.input} value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)} />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>PAN No.</label>
                    <input type="text" className={styles.input} value={pan} onChange={(e) => setPan(e.target.value)} />
                </div>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Aadhaar No.</label>
                    <input type="text" className={styles.input} value={aadhar} onChange={(e) => setAadhar(e.target.value)} />
                </div>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Role</label>
                <select className={styles.select} value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                    <option value="owner">owner</option>
                </select>
            </div>

            {branches.length > 0 && roles.length > 0 ? (
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Branch Access</label>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                        {branches.map((branch) => {
                            const current = branchAccess[branch.id] || { enabled: false, role_id: roles.find((r) => r.name === role)?.id || roles[0]?.id || '' };
                            return (
                                <div key={branch.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 180px', gap: '0.5rem', alignItems: 'center' }}>
                                    <input
                                        type="checkbox"
                                        checked={current.enabled}
                                        onChange={(e) => setBranchAccess((prev) => ({
                                            ...prev,
                                            [branch.id]: { ...current, enabled: e.target.checked },
                                        }))}
                                    />
                                    <span>{branch.name}</span>
                                    <select
                                        className={styles.select}
                                        value={current.role_id}
                                        disabled={!current.enabled}
                                        onChange={(e) => setBranchAccess((prev) => ({
                                            ...prev,
                                            [branch.id]: { ...current, role_id: e.target.value },
                                        }))}
                                    >
                                        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}

            <div className={styles.inputGroup}>
                <label className={styles.label}>Attachments</label>
                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    {user?.documents && user.documents.length > 0
                        ? user.documents.map((d) => d.name).join(', ')
                        : 'No attachments'}
                </div>
            </div>

            {canRenderDelete ? (
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Delete User</label>
                    <button
                        type="button"
                        className={styles.cancelBtn}
                        disabled={!!deleting || !!disableDelete}
                        onClick={() => {
                            if (!user) return;
                            if (disableDelete) return;
                            const ok = window.confirm(
                                'Delete this user? This will disable login but keep all history (bills/payments/etc.) intact.',
                            );
                            if (!ok) return;
                            onDelete(user.id);
                        }}
                    >
                        {deleting ? 'Deleting…' : 'Delete User'}
                    </button>
                    {disableDeleteReason ? (
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 6 }}>
                            {disableDeleteReason}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </BaseModal>
    );
}

interface CreateShiftModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated?: () => void;
}

export function CreateShiftModal({ isOpen, onClose, onCreated }: CreateShiftModalProps) {
    const [shiftData, setShiftData] = useState({ name: "", start: "", end: "" });
    const [monthlyFee, setMonthlyFee] = useState<string>('');
    const [seatTypes, setSeatTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [pricingByType, setPricingByType] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) return;

        const controller = new AbortController();
        fetch(`${API_BASE_URL}/library/seat-types`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        })
            .then(async (res) => {
                const body = await res.json().catch(() => ([]));
                if (!res.ok) throw new Error('Failed to load seat types');
                const list = Array.isArray(body) ? body : [];
                setSeatTypes(list);
                // Initialize pricing map only once per open.
                const next: Record<string, string> = {};
                for (const t of list) next[t.id] = '';
                setPricingByType(next);
            })
            .catch(() => {
                setSeatTypes([]);
                setPricingByType({});
            });

        return () => controller.abort();
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        const name = shiftData.name.trim();
        if (!name || !shiftData.start || !shiftData.end) return;

        const parsedFee = monthlyFee.trim() ? Number(monthlyFee) : null;
        if (monthlyFee.trim() && (!Number.isFinite(parsedFee) || parsedFee! < 0)) {
            alert('Please enter a valid monthly fee');
            return;
        }

        // If seat types exist, require per-type pricing.
        let pricing: Array<{ seat_type_id: string; monthly_fee: number }> | undefined;
        if (seatTypes.length > 0) {
            const rows: Array<{ seat_type_id: string; monthly_fee: number }> = [];
            for (const t of seatTypes) {
                const raw = (pricingByType[t.id] ?? '').trim();
                const num = raw === '' ? NaN : Number(raw);
                if (!Number.isFinite(num) || num < 0) {
                    alert(`Please enter a valid monthly fee for ${t.name}`);
                    return;
                }
                rows.push({ seat_type_id: t.id, monthly_fee: Math.trunc(num) });
            }
            pricing = rows;
        }

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/library/shifts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    name,
                    start_time: shiftData.start,
                    end_time: shiftData.end,
                    monthly_fee: parsedFee,
                    pricing,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.message || 'Failed to create shift');

            setShiftData({ name: '', start: '', end: '' });
            setMonthlyFee('');
            setPricingByType({});
            onClose();
            onCreated?.();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Configure Library Shift"
            onSubmit={handleSubmit}
            submitDisabled={saving}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Shift Name</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Morning Shift"
                    required
                    value={shiftData.name}
                    onChange={e => setShiftData({ ...shiftData, name: e.target.value })}
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Start Time</label>
                    <input
                        type="time"
                        className={styles.input}
                        required
                        value={shiftData.start}
                        onChange={e => setShiftData({ ...shiftData, start: e.target.value })}
                    />
                </div>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>End Time</label>
                    <input
                        type="time"
                        className={styles.input}
                        required
                        value={shiftData.end}
                        onChange={e => setShiftData({ ...shiftData, end: e.target.value })}
                    />
                </div>
            </div>

            {seatTypes.length > 0 ? (
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Monthly Fee by Seat Type (₹)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        {seatTypes.map((t) => (
                            <div key={t.id} className={styles.inputGroup} style={{ marginBottom: 0 }}>
                                <label className={styles.label}>{t.name}</label>
                                <input
                                    type="number"
                                    className={styles.input}
                                    placeholder="e.g. 500"
                                    value={pricingByType[t.id] ?? ''}
                                    onChange={(e) => setPricingByType((p) => ({ ...p, [t.id]: e.target.value }))}
                                    min={0}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Monthly Fee for this Shift (₹)</label>
                    <input
                        type="number"
                        className={styles.input}
                        placeholder="e.g. 500"
                        value={monthlyFee}
                        onChange={(e) => setMonthlyFee(e.target.value)}
                        min={0}
                    />
                </div>
            )}

        </BaseModal>
    );
}

interface AddSeatTypeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated?: () => void;
}

export function AddSeatTypeModal({ isOpen, onClose, onCreated }: AddSeatTypeModalProps) {
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);

    const handleClose = () => {
        if (saving) return;
        setName('');
        onClose();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        const trimmed = name.trim();
        if (!trimmed) return;

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/library/seat-types`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ name: trimmed }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.message || 'Failed to create seat type');

            setName('');
            onClose();
            onCreated?.();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={handleClose}
            title="Add Seat Type"
            onSubmit={handleSubmit}
            submitDisabled={saving || !name.trim()}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Seat Type Name</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. General / Executive"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>
        </BaseModal>
    );
}

interface AddSeatModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated?: () => void;
}

export function AddSeatModal({ isOpen, onClose, onCreated }: AddSeatModalProps) {
    const [seatNumber, setSeatNumber] = useState('');
    const [hallId, setHallId] = useState<string>('');
    const [halls, setHalls] = useState<Array<{ id: string; name: string }>>([]);
    const [loadingHalls, setLoadingHalls] = useState(false);
    const [seatTypeId, setSeatTypeId] = useState<string>('');
    const [seatTypes, setSeatTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [loadingSeatTypes, setLoadingSeatTypes] = useState(false);
    const [saving, setSaving] = useState(false);

    function parseSeatNumbers(input: string): string[] {
        const raw = input.trim();
        if (!raw) return [];

        const rangeMatch = raw.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
        if (rangeMatch) {
            const start = Number(rangeMatch[1]);
            const end = Number(rangeMatch[2]);
            if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0) return [];
            if (end < start) return [];
            const count = end - start + 1;
            // Safety guard to prevent accidental huge inserts.
            if (count > 500) return [];
            return Array.from({ length: count }, (_, i) => String(start + i));
        }

        // Single seat number.
        const singleMatch = raw.match(/^\d+$/);
        if (singleMatch) return [raw];

        return [];
    }

    useEffect(() => {
        if (!isOpen) return;
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) return;

        const controller = new AbortController();
        setLoadingHalls(true);
        fetch(`${API_BASE_URL}/library/halls`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
        })
            .then(async (res) => {
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body?.message || 'Failed to load halls');
                setHalls(Array.isArray(body) ? body : []);
            })
            .catch(() => {
                // Keep UX minimal: fail silently and allow seat creation without hall.
                setHalls([]);
            })
            .finally(() => setLoadingHalls(false));

        setLoadingSeatTypes(true);
        fetch(`${API_BASE_URL}/library/seat-types`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
        })
            .then(async (res) => {
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body?.message || 'Failed to load seat types');
                setSeatTypes(Array.isArray(body) ? body : []);
            })
            .catch(() => {
                setSeatTypes([]);
            })
            .finally(() => setLoadingSeatTypes(false));

        return () => controller.abort();
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        const seatNumbers = parseSeatNumbers(seatNumber);
        if (seatNumbers.length === 0) {
            alert('Enter a seat number or a range like 1-26 (max 500).');
            return;
        }
        setSaving(true);
        try {
            for (const num of seatNumbers) {
                const res = await fetch(`${API_BASE_URL}/library/seats`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        seat_number: num,
                        hall_id: hallId || null,
                        seat_type_id: seatTypeId || null,
                    }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body?.message || `Failed to add seat ${num}`);
            }

            alert(seatNumbers.length === 1 ? 'Seat Added!' : `${seatNumbers.length} Seats Added!`);
            onCreated?.();
            onClose();
            setSeatNumber('');
            setHallId('');
            setSeatTypeId('');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Add New Seat"
            onSubmit={handleSubmit}
            submitDisabled={saving}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Seat Number</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. 1 or 1-26"
                    required
                    value={seatNumber}
                    onChange={(e) => setSeatNumber(e.target.value)}
                />
            </div>
            <div className={styles.inputGroup}>
                <label className={styles.label}>Floor / Hall</label>
                <select
                    className={styles.input}
                    value={hallId}
                    onChange={(e) => setHallId(e.target.value)}
                    disabled={loadingHalls || halls.length === 0}
                >
                    <option value="">{loadingHalls ? 'Loading halls...' : halls.length === 0 ? 'No halls yet' : 'No hall'}</option>
                    {halls.map((h) => (
                        <option key={h.id} value={h.id}>
                            {h.name}
                        </option>
                    ))}
                </select>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Seat Type</label>
                <select
                    className={styles.input}
                    value={seatTypeId}
                    onChange={(e) => setSeatTypeId(e.target.value)}
                    disabled={loadingSeatTypes || seatTypes.length === 0}
                >
                    <option value="">{loadingSeatTypes ? 'Loading seat types...' : seatTypes.length === 0 ? 'No seat types yet' : 'Select seat type'}</option>
                    {seatTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                            {t.name}
                        </option>
                    ))}
                </select>
            </div>
        </BaseModal>
    );
}

interface AddHallModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated?: () => void;
}

export function AddHallModal({ isOpen, onClose, onCreated }: AddHallModalProps) {
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);

    const handleClose = () => {
        if (saving) return;
        setName('');
        onClose();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        const trimmed = name.trim();
        if (!trimmed) return;

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/library/halls`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ name: trimmed }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.message || 'Failed to create hall');

            setName('');
            onClose();
            onCreated?.();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={handleClose}
            title="Add New Hall"
            onSubmit={handleSubmit}
            submitDisabled={saving || !name.trim()}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Hall Name</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Reading Room"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>
        </BaseModal>
    );
}

interface EditHallModalProps {
    isOpen: boolean;
    onClose: () => void;
    hallId: string;
    defaultName: string;
    onUpdated?: () => void;
}

export function EditHallModal({ isOpen, onClose, hallId, defaultName, onUpdated }: EditHallModalProps) {
    const [name, setName] = useState(defaultName);
    const [loadingSeats, setLoadingSeats] = useState(false);
    const [saving, setSaving] = useState(false);
    const [seats, setSeats] = useState<Array<{ id: string; seat_number: string; status: 'available' | 'occupied' | 'maintenance' }>>(
        [],
    );

    const refreshSeats = async () => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) return;

        setLoadingSeats(true);
        try {
            const res = await fetch(`${API_BASE_URL}/library/seats`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const body = await res.json().catch(() => ([]));
            if (!res.ok) throw new Error('Failed to load seats');
            const list = Array.isArray(body) ? (body as unknown[]) : [];
            const filtered = list
                .map((raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null))
                .filter((rec): rec is Record<string, unknown> => Boolean(rec))
                .filter((rec) => String(rec.hall_id ?? '') === String(hallId))
                .map((rec) => {
                    const statusRaw = rec.status;
                    const status: 'available' | 'occupied' | 'maintenance' =
                        statusRaw === 'occupied' || statusRaw === 'maintenance' ? statusRaw : 'available';
                    return {
                        id: String(rec.id),
                        seat_number: String(rec.seat_number ?? ''),
                        status,
                    };
                })
                .sort((a, b) =>
                    String(a.seat_number).localeCompare(String(b.seat_number), undefined, { numeric: true, sensitivity: 'base' }),
                );
            setSeats(filtered);
        } catch {
            setSeats([]);
        } finally {
            setLoadingSeats(false);
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        setName(defaultName);
        void refreshSeats();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, hallId, defaultName]);

    const updateSeatStatus = async (seatId: string, status: 'available' | 'occupied' | 'maintenance') => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) return;
        try {
            const res = await fetch(`${API_BASE_URL}/library/seats/${seatId}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.message || 'Failed to update seat');
            await refreshSeats();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        }
    };

    const deleteSeat = async (seatId: string) => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) return;
        if (!confirm('Delete this seat? This cannot be undone.')) return;
        try {
            const res = await fetch(`${API_BASE_URL}/library/seats/${seatId}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.message || 'Failed to delete seat');
            await refreshSeats();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        const trimmed = name.trim();
        if (!trimmed) return;

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/library/halls/${hallId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ name: trimmed }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.message || 'Failed to update hall');

            onClose();
            onUpdated?.();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit Hall"
            onSubmit={handleSubmit}
            submitDisabled={saving || !name.trim()}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Hall Name</label>
                <input
                    type="text"
                    className={styles.input}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>

            <div style={{ marginTop: '1rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Seats in this Hall</div>
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '0.5rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'center', verticalAlign: 'middle', padding: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>Seat</th>
                                <th style={{ textAlign: 'center', verticalAlign: 'middle', padding: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>Status</th>
                                <th style={{ textAlign: 'center', verticalAlign: 'middle', padding: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loadingSeats ? (
                                <tr>
                                    <td style={{ padding: '0.5rem' }} colSpan={3}>
                                        Loading...
                                    </td>
                                </tr>
                            ) : seats.length === 0 ? (
                                <tr>
                                    <td style={{ padding: '0.5rem', textAlign: 'center', verticalAlign: 'middle' }} colSpan={3}>
                                        No seats found.
                                    </td>
                                </tr>
                            ) : (
                                seats.map((s) => (
                                    <tr key={s.id}>
                                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #e2e8f0', textAlign: 'center', verticalAlign: 'middle' }}>
                                            #{s.seat_number}
                                        </td>
                                        <td
                                            style={{
                                                padding: '0.5rem',
                                                borderBottom: '1px solid #e2e8f0',
                                                textTransform: 'capitalize',
                                                textAlign: 'center',
                                                verticalAlign: 'middle',
                                            }}
                                        >
                                            {s.status}
                                        </td>
                                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #e2e8f0', textAlign: 'center', verticalAlign: 'middle' }}>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                {s.status === 'maintenance' ? (
                                                    <button
                                                        type="button"
                                                        className={styles.secondaryBtn}
                                                        onClick={() => void updateSeatStatus(s.id, 'available')}
                                                    >
                                                        Mark Available
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className={styles.secondaryBtn}
                                                        onClick={() => void updateSeatStatus(s.id, 'maintenance')}
                                                    >
                                                        Mark Unserviceable
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    className={styles.dangerBtn}
                                                    onClick={() => void deleteSeat(s.id)}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </BaseModal>
    );
}

interface DeleteHallModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDeleted?: () => void;
}

export function DeleteHallModal({ isOpen, onClose, onDeleted }: DeleteHallModalProps) {
    const [halls, setHalls] = useState<Array<{ id: string; name: string }>>([]);
    const [hallId, setHallId] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) return;

        const controller = new AbortController();
        setLoading(true);
        fetch(`${API_BASE_URL}/library/halls`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        })
            .then(async (res) => {
                const body = await res.json().catch(() => ([]));
                if (!res.ok) throw new Error('Failed to load halls');
                const list = Array.isArray(body) ? body : [];
                setHalls(list);
                setHallId(list[0]?.id ?? '');
            })
            .catch(() => {
                setHalls([]);
                setHallId('');
            })
            .finally(() => setLoading(false));

        return () => controller.abort();
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }
        if (!hallId) return;
        if (!confirm('Delete this hall? Seats will be unassigned from this hall.')) return;

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/library/halls/${hallId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.message || 'Failed to delete hall');

            onClose();
            onDeleted?.();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Delete Hall"
            onSubmit={handleSubmit}
            submitDisabled={saving || loading || !hallId}
            submitLabel={saving ? 'Deleting...' : 'Delete'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Hall</label>
                <select
                    className={styles.input}
                    value={hallId}
                    onChange={(e) => setHallId(e.target.value)}
                    disabled={loading || halls.length === 0}
                >
                    {halls.length === 0 ? (
                        <option value="">{loading ? 'Loading...' : 'No halls found'}</option>
                    ) : null}
                    {halls.map((h) => (
                        <option key={h.id} value={h.id}>
                            {h.name}
                        </option>
                    ))}
                </select>
            </div>
        </BaseModal>
    );
}

interface EditShiftPricesModalProps {
    isOpen: boolean;
    onClose: () => void;
    shiftId: string;
    onUpdated?: () => void;
}

export function EditShiftPricesModal({ isOpen, onClose, shiftId, onUpdated }: EditShiftPricesModalProps) {
    const [saving, setSaving] = useState(false);
    const [seatTypes, setSeatTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [pricingByType, setPricingByType] = useState<Record<string, string>>({});
    const [monthlyFee, setMonthlyFee] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) return;

        const controller = new AbortController();
        Promise.all([
            fetch(`${API_BASE_URL}/library/seat-types`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }),
            fetch(`${API_BASE_URL}/library/shifts`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }),
        ])
            .then(async ([typesRes, shiftsRes]) => {
                const typesBody = typesRes.ok ? await typesRes.json().catch(() => ([])) : [];
                const shiftsBody = shiftsRes.ok ? await shiftsRes.json().catch(() => ([])) : [];
                const types = Array.isArray(typesBody) ? typesBody : [];
                const shifts = Array.isArray(shiftsBody) ? shiftsBody : [];

                setSeatTypes(types);

                const shift = shifts
                    .map((raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null))
                    .filter((rec): rec is Record<string, unknown> => Boolean(rec))
                    .find((rec) => String(rec.id ?? '') === String(shiftId));
                const next: Record<string, string> = {};
                for (const t of types) next[t.id] = '';

                const pricingRaw = shift?.pricing;
                if (Array.isArray(pricingRaw)) {
                    for (const rowRaw of pricingRaw) {
                        if (!rowRaw || typeof rowRaw !== 'object') continue;
                        const row = rowRaw as Record<string, unknown>;
                        const seatTypeId = row.seat_type_id;
                        if (typeof seatTypeId === 'string' && seatTypeId) {
                            next[seatTypeId] = String(row.monthly_fee ?? '');
                        }
                    }
                }
                setPricingByType(next);
                setMonthlyFee(shift?.monthly_fee != null ? String(shift.monthly_fee) : '');
            })
            .catch(() => {
                setSeatTypes([]);
                setPricingByType({});
                setMonthlyFee('');
            });

        return () => controller.abort();
    }, [isOpen, shiftId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        let payload: Record<string, unknown> = {};
        if (seatTypes.length > 0) {
            const rows: Array<{ seat_type_id: string; monthly_fee: number }> = [];
            for (const t of seatTypes) {
                const raw = (pricingByType[t.id] ?? '').trim();
                const num = raw === '' ? NaN : Number(raw);
                if (!Number.isFinite(num) || num < 0) {
                    alert(`Please enter a valid monthly fee for ${t.name}`);
                    return;
                }
                rows.push({ seat_type_id: t.id, monthly_fee: Math.trunc(num) });
            }
            payload = { pricing: rows };
        } else {
            const raw = monthlyFee.trim();
            const num = raw === '' ? NaN : Number(raw);
            if (!Number.isFinite(num) || num < 0) {
                alert('Please enter a valid monthly fee');
                return;
            }
            payload = { monthly_fee: Math.trunc(num) };
        }

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/library/shifts/${shiftId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.message || 'Failed to update shift prices');

            onClose();
            onUpdated?.();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit Shift Prices"
            onSubmit={handleSubmit}
            submitDisabled={saving}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            {seatTypes.length > 0 ? (
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Monthly Fee by Seat Type (₹)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        {seatTypes.map((t) => (
                            <div key={t.id} className={styles.inputGroup} style={{ marginBottom: 0 }}>
                                <label className={styles.label}>{t.name}</label>
                                <input
                                    type="number"
                                    className={styles.input}
                                    placeholder="e.g. 500"
                                    value={pricingByType[t.id] ?? ''}
                                    onChange={(e) => setPricingByType((p) => ({ ...p, [t.id]: e.target.value }))}
                                    min={0}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Monthly Fee (₹)</label>
                    <input
                        type="number"
                        className={styles.input}
                        placeholder="e.g. 500"
                        value={monthlyFee}
                        onChange={(e) => setMonthlyFee(e.target.value)}
                        min={0}
                    />
                </div>
            )}
        </BaseModal>
    );
}

interface CreateMembershipModalProps {
    isOpen: boolean;
    onClose: () => void;
    defaultShiftId?: string | null;
    defaultSeatTypeId?: string | null;
    defaultReservedSeatId?: string | null;
    onCreated?: (created: { shift_id: string; reserved_seat_id: string | null }) => void;
}

export function CreateMembershipModal({
    isOpen,
    onClose,
    defaultShiftId,
    defaultSeatTypeId,
    defaultReservedSeatId,
    onCreated,
}: CreateMembershipModalProps) {
    const [saving, setSaving] = useState(false);
    const [students, setStudents] = useState<Array<{ id: string; full_name: string }>>([]);
    const [shifts, setShifts] = useState<Array<{ id: string; name: string }>>([]);
    const [seatTypes, setSeatTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [seats, setSeats] = useState<Array<{ id: string; seat_number: string; seat_type_id: string | null }>>([]);

    const [studentId, setStudentId] = useState('');
    const [shiftId, setShiftId] = useState('');
    const [seatTypeId, setSeatTypeId] = useState('');
    const [reservedSeatId, setReservedSeatId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reservedFee, setReservedFee] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) return;

        const controller = new AbortController();
        Promise.all([
            fetch(`${API_BASE_URL}/students`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }),
            fetch(`${API_BASE_URL}/library/shifts`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }),
            fetch(`${API_BASE_URL}/library/seat-types`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }),
            fetch(`${API_BASE_URL}/library/seats`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }),
        ])
            .then(async ([studentsRes, shiftsRes, typesRes, seatsRes]) => {
                const studentsBody = studentsRes.ok ? await studentsRes.json().catch(() => ([])) : [];
                const shiftsBody = shiftsRes.ok ? await shiftsRes.json().catch(() => ([])) : [];
                const typesBody = typesRes.ok ? await typesRes.json().catch(() => ([])) : [];
                const seatsBody = seatsRes.ok ? await seatsRes.json().catch(() => ([])) : [];

                setStudents(Array.isArray(studentsBody) ? studentsBody : []);
                setShifts(Array.isArray(shiftsBody) ? shiftsBody : []);
                setSeatTypes(Array.isArray(typesBody) ? typesBody : []);
                setSeats(Array.isArray(seatsBody) ? seatsBody : []);
            })
            .catch(() => {
                setStudents([]);
                setShifts([]);
                setSeatTypes([]);
                setSeats([]);
            });

        // Apply defaults
        setShiftId(defaultShiftId || '');
        setSeatTypeId(defaultSeatTypeId || '');
        setReservedSeatId(defaultReservedSeatId || '');

        return () => controller.abort();
    }, [isOpen, defaultShiftId, defaultSeatTypeId, defaultReservedSeatId]);

    const reservedSeatOptions = seats
        .filter((s) => (seatTypeId ? s.seat_type_id === seatTypeId : true))
        .sort((a, b) => Number(a.seat_number) - Number(b.seat_number));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }

        if (!studentId || !shiftId || !seatTypeId) {
            alert('Student, shift and seat type are required');
            return;
        }

        const parsedReservedFee = reservedFee.trim() ? Number(reservedFee) : null;
        if (reservedFee.trim() && (!Number.isFinite(parsedReservedFee) || parsedReservedFee! < 0)) {
            alert('Please enter a valid reserved fee');
            return;
        }

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/library/memberships`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    student_id: studentId,
                    shift_id: shiftId,
                    seat_type_id: seatTypeId,
                    start_date: startDate || undefined,
                    end_date: endDate || null,
                    reserved_seat_id: reservedSeatId || null,
                    reserved_fee: parsedReservedFee,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.message || 'Failed to create admission');

            onClose();
            onCreated?.({ shift_id: shiftId, reserved_seat_id: reservedSeatId || null });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Library Admission"
            onSubmit={handleSubmit}
            submitDisabled={saving}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Student</label>
                <StudentCombobox
                    students={students}
                    value={studentId}
                    onChange={setStudentId}
                    inputClassName={styles.input}
                    placeholder="Search student (type name)"
                    required
                />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Shift</label>
                    <select className={styles.input} value={shiftId} onChange={(e) => setShiftId(e.target.value)} required>
                        <option value="">Select shift</option>
                        {shifts.map((sh) => (
                            <option key={sh.id} value={sh.id}>
                                {sh.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Seat Type</label>
                    <select className={styles.input} value={seatTypeId} onChange={(e) => setSeatTypeId(e.target.value)} required>
                        <option value="">Select seat type</option>
                        {seatTypes.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Start Date (optional)</label>
                    <input type="date" className={styles.input} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>End Date (optional)</label>
                    <input type="date" className={styles.input} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Reserved Seat (optional)</label>
                <select className={styles.input} value={reservedSeatId} onChange={(e) => setReservedSeatId(e.target.value)} disabled={!seatTypeId}>
                    <option value="">No reserved seat</option>
                    {reservedSeatOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                            Seat {s.seat_number}
                        </option>
                    ))}
                </select>
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Reserved Seat Fee (₹) (optional)</label>
                <input
                    type="number"
                    className={styles.input}
                    placeholder="e.g. 200"
                    value={reservedFee}
                    onChange={(e) => setReservedFee(e.target.value)}
                    min={0}
                    disabled={!reservedSeatId}
                />
            </div>
        </BaseModal>
    );
}

interface CheckInSeatModalProps {
    isOpen: boolean;
    onClose: () => void;
    shiftId: string;
    seatId: string;
    seatTypeId?: string | null;
    onCheckedIn?: () => void;
}

export function CheckInSeatModal({ isOpen, onClose, shiftId, seatId, seatTypeId, onCheckedIn }: CheckInSeatModalProps) {
    const [saving, setSaving] = useState(false);
    const [memberships, setMemberships] = useState<Array<{ id: string; student_name: string; reserved_seat_id?: string | null }>>([]);
    const [membershipId, setMembershipId] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) return;
        const controller = new AbortController();

        const qs = new URLSearchParams();
        qs.set('shift_id', shiftId);
        if (seatTypeId) qs.set('seat_type_id', seatTypeId);
        qs.set('active', 'true');

        fetch(`${API_BASE_URL}/library/memberships?${qs.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        })
            .then(async (res) => {
                const body = await res.json().catch(() => ([]));
                if (!res.ok) throw new Error('Failed to load admissions');
                const list = Array.isArray(body) ? body : [];
                // Only allow non-reserved admissions here.
                setMemberships(list.filter((m) => !m.reserved_seat_id));
                setMembershipId('');
            })
            .catch(() => {
                setMemberships([]);
            });

        return () => controller.abort();
    }, [isOpen, shiftId, seatTypeId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }
        if (!membershipId) {
            alert('Please select a student admission');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/library/checkins`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ membership_id: membershipId, seat_id: seatId }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.message || 'Check-in failed');

            onClose();
            onCheckedIn?.();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Check In Student"
            onSubmit={handleSubmit}
            submitDisabled={saving}
            submitLabel={saving ? 'Saving...' : 'Check In'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Admission</label>
                <StudentCombobox
                    students={memberships.map((m) => ({ id: m.id, full_name: m.student_name }))}
                    value={membershipId}
                    onChange={setMembershipId}
                    inputClassName={styles.input}
                    placeholder="Search student (type name)"
                    required
                />
            </div>
        </BaseModal>
    );
}

interface RenewMembershipModalProps {
    isOpen: boolean;
    onClose: () => void;
    membershipId: string;
    currentEndDate?: string | null;
    onRenewed?: () => void;
}

function addDaysISODate(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

export function RenewMembershipModal({ isOpen, onClose, membershipId, currentEndDate, onRenewed }: RenewMembershipModalProps) {
    const [saving, setSaving] = useState(false);
    const [endDate, setEndDate] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setEndDate(currentEndDate || addDaysISODate(30));
    }, [isOpen, currentEndDate]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token) {
            alert('You are not logged in.');
            return;
        }
        if (!endDate) {
            alert('Please select an end date');
            return;
        }

        setSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/library/memberships/${membershipId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ end_date: endDate }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.message || 'Failed to renew');

            onClose();
            onRenewed?.();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            alert(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Renew Seat"
            onSubmit={handleSubmit}
            submitDisabled={saving}
            submitLabel={saving ? 'Saving...' : 'Save'}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Occupied Until</label>
                <input type="date" className={styles.input} value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
        </BaseModal>
    );
}

interface AddSubjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (name: string) => void;
}

export function AddSubjectModal({ isOpen, onClose, onAdd }: AddSubjectModalProps) {
    const [name, setName] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onAdd(name);
        setName("");
        onClose();
    };

    return (
        <BaseModal isOpen={isOpen} onClose={onClose} title="Add New Subject" onSubmit={handleSubmit}>
            <div className={styles.inputGroup}>
                <label className={styles.label}>Subject Name</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Physics, Organic Chemistry"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>
        </BaseModal>
    );
}

interface AddTopicModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (topic: string) => void;
    subjectName?: string;
}

export function AddTopicModal({ isOpen, onClose, onAdd, subjectName }: AddTopicModalProps) {
    const [topic, setTopic] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onAdd(topic);
        setTopic("");
        onClose();
    };

    return (
        <BaseModal isOpen={isOpen} onClose={onClose} title={`Add Topic to ${subjectName || 'Subject'}`} onSubmit={handleSubmit}>
            <div className={styles.inputGroup}>
                <label className={styles.label}>Topic / Chapter Name</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Thermodynamics"
                    required
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                />
            </div>
        </BaseModal>
    );
}

interface AddSubpartModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (name: string) => void;
    topicName?: string;
}

export function AddSubpartModal({ isOpen, onClose, onAdd, topicName }: AddSubpartModalProps) {
    const [name, setName] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onAdd(name);
        setName("");
        onClose();
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title={`Add Subpart to ${topicName || 'Chapter'}`}
            onSubmit={handleSubmit}
        >
            <div className={styles.inputGroup}>
                <label className={styles.label}>Subpart Name</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Laws of Motion"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>
        </BaseModal>
    );
}

interface AddSubjectMaterialModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (data: { title: string; url: string; description?: string; thumbnailUrl?: string; thumbnailFile?: File }) => void;
}

export function AddSubjectMaterialModal({ isOpen, onClose, onAdd }: AddSubjectMaterialModalProps) {
    const [title, setTitle] = useState('');
    const [url, setUrl] = useState('');
    const [description, setDescription] = useState('');
    const [thumbnailUrl, setThumbnailUrl] = useState('');
    const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
    const [fileInputKey, setFileInputKey] = useState(0);
    const [cropOpen, setCropOpen] = useState(false);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [cropFileName, setCropFileName] = useState('thumbnail.jpg');

    const handleClose = () => {
        if (cropSrc) URL.revokeObjectURL(cropSrc);
        setTitle('');
        setUrl('');
        setDescription('');
        setThumbnailUrl('');
        setThumbnailFile(null);
        setCropOpen(false);
        setCropSrc(null);
        setFileInputKey((k) => k + 1);
        onClose();
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onAdd({
            title,
            url,
            description: description.trim() ? description : undefined,
            thumbnailUrl: thumbnailUrl.trim() ? thumbnailUrl : undefined,
            thumbnailFile: thumbnailFile ?? undefined,
        });
        handleClose();
    };

    return (
        <BaseModal isOpen={isOpen} onClose={handleClose} title="Add Subject Material" onSubmit={handleSubmit}>
            <div className={styles.inputGroup}>
                <label className={styles.label}>Title</label>
                <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Chapter 1 Notes PDF"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                />
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>PDF / Link URL</label>
                <input
                    type="url"
                    className={styles.input}
                    placeholder="https://..."
                    required
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                />
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Description (optional)</label>
                <textarea
                    className={styles.textarea}
                    placeholder="What is this material for?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                />
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Thumbnail URL (optional)</label>
                <input
                    type="url"
                    className={styles.input}
                    placeholder="https://.../thumb.png"
                    value={thumbnailUrl}
                    onChange={(e) => setThumbnailUrl(e.target.value)}
                />
            </div>

            <div className={styles.inputGroup}>
                <label className={styles.label}>Upload Thumbnail (optional)</label>
                <input
                    key={fileInputKey}
                    type="file"
                    className={styles.input}
                    accept="image/*"
                    onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        if (!file) {
                            setThumbnailFile(null);
                            return;
                        }
                        if (cropSrc) URL.revokeObjectURL(cropSrc);
                        const url = URL.createObjectURL(file);
                        setCropFileName(file.name || 'thumbnail.jpg');
                        setCropSrc(url);
                        setCropOpen(true);
                    }}
                />
            </div>

            <CropImageModal
                isOpen={cropOpen}
                src={cropSrc}
                fileName={cropFileName}
                title="Crop Thumbnail"
                outWidth={MATERIAL_THUMBNAIL_VIEWBOX_WIDTH}
                outHeight={MATERIAL_THUMBNAIL_VIEWBOX_HEIGHT}
                aspect={MATERIAL_THUMBNAIL_VIEWBOX_WIDTH / MATERIAL_THUMBNAIL_VIEWBOX_HEIGHT}
                onClose={() => {
                    setCropSrc((prev) => {
                        if (prev) URL.revokeObjectURL(prev);
                        return null;
                    });
                    setCropOpen(false);
                    setThumbnailFile(null);
                    setFileInputKey((k) => k + 1);
                }}
                onCropped={(file) => {
                    setCropSrc((prev) => {
                        if (prev) URL.revokeObjectURL(prev);
                        return null;
                    });
                    setThumbnailFile(file);
                    setCropOpen(false);
                }}
            />
        </BaseModal>
    );
}
