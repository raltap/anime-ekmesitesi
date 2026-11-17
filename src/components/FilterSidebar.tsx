import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CloudUpload,
  ExternalLink,
  FolderOpen,
  FolderSync,
  Loader2,
  LogOut,
  Moon,
  RotateCcw,
  Sun,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_DRIVE_FOLDER_ID, parseDriveFolderId } from '../shared/playerPriority.ts';
import type {
  ArchiveStatus,
  DownloadSettings,
  DriveSyncStatus,
  FilterState,
} from '../shared/types.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

interface FilterSidebarProps {
  filters: FilterState;
  onFiltersChange: (next: FilterState) => void;
  onResetFilters: () => void;
  availablePlayers: string[];
  settings: DownloadSettings;
  onUpdateSettings: (next: DownloadSettings) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  driveConnected: boolean;
  driveSessionExpired: boolean;
  driveUserEmail: string | null;
  driveFolderName: string | null;
  driveFolderWarning: string | null;
  driveSyncStatus?: DriveSyncStatus | null;
  pendingDriveCount: number;
  isDriveLoggingIn: boolean;
  isSyncingDrive: boolean;
  isUploadingPendingDrive: boolean;
  onDriveSignIn: () => void;
  onDriveSignOut: () => void;
  onDriveTestFolder: (folderId: string) => void;
  onDriveSyncFolder: () => void;
  onUploadPendingToDrive: () => void;
}

export function FilterSidebar({
  filters,
  onFiltersChange,
  onResetFilters,
  availablePlayers,
  settings,
  onUpdateSettings,
  darkMode,
  onToggleDarkMode,
  driveConnected,
  driveSessionExpired,
  driveUserEmail,
  driveFolderName,
  driveFolderWarning,
  driveSyncStatus,
  pendingDriveCount,
  isDriveLoggingIn,
  isSyncingDrive,
  isUploadingPendingDrive,
  onDriveSignIn,
  onDriveSignOut,
  onDriveTestFolder,
  onDriveSyncFolder,
  onUploadPendingToDrive,
}: FilterSidebarProps) {
  const [folderInput, setFolderInput] = useState(
    settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID,
  );

  useEffect(() => {
    setFolderInput(settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID);
  }, [settings.driveFolderId]);

  const movePlayerPriority = (index: number, delta: -1 | 1) => {
    const nextIdx = index + delta;
    if (nextIdx < 0 || nextIdx >= settings.preferredPlayers.length) return;
    const copy = [...settings.preferredPlayers];
    const [item] = copy.splice(index, 1);
    copy.splice(nextIdx, 0, item);
    onUpdateSettings({ ...settings, preferredPlayers: copy });
  };

  const applyDriveFolder = () => {
    const parsed = parseDriveFolderId(folderInput) || DEFAULT_DRIVE_FOLDER_ID;
    setFolderInput(parsed);
    onUpdateSettings({ ...settings, driveFolderId: parsed });
    onDriveTestFolder(parsed);
  };

  const missingOptions: Array<{ value: FilterState['missingCount']; label: string }> = [
    { value: 'all', label: 'Tümü' },
    { value: '1', label: '1 Bölüm' },
    { value: '2', label: '2 Bölüm' },
    { value: '3', label: '3 Bölüm' },
  ];

  const archiveOptions: Array<{ value: 'all' | ArchiveStatus; label: string }> = [
    { value: 'all', label: 'Tümü' },
    { value: 'tam', label: 'Tam Arşiv' },
    { value: 'kismi', label: 'Kısmi' },
    { value: 'yok', label: 'Yok' },
  ];

  const qualityModeValue = settings.strict1080p
    ? '1080'
    : String(settings.minQualityHeight ?? 720);

  return (
    <aside className="w-full lg:w-[272px] shrink-0 space-y-5">
      {/* Filtreler */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Filtreler
          </h2>
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 whitespace-nowrap"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            <span>Sıfırla</span>
          </button>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            Eksik Bölüm Sayısı
          </span>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {missingOptions.map((opt) => {
              const active = filters.missingCount === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onFiltersChange({ ...filters, missingCount: opt.value })}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            Arşiv Durumu
          </span>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {archiveOptions.map((opt) => {
              const active = filters.archiveStatus === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onFiltersChange({ ...filters, archiveStatus: opt.value })}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="player-filter-select"
            className="block text-xs font-medium text-slate-600 dark:text-slate-400"
          >
            Oynatıcı İçerenler
          </label>
          <select
            id="player-filter-select"
            value={filters.player}
            onChange={(e) => onFiltersChange({ ...filters, player: e.target.value })}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            <option value="">Bütün oynatıcılar</option>
            {availablePlayers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-start gap-2 pt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(filters.showCompleted)}
            onChange={(e) => onFiltersChange({ ...filters, showCompleted: e.target.checked })}
            className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600"
          />
          <span className="text-xs leading-snug text-slate-700 dark:text-slate-300">
            Tamamlananları da göster
          </span>
        </label>
      </div>

      {/* Google Drive Hedefi */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <FolderOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <span>Google Drive Hedefi</span>
          </h2>
          <a
            href={`https://drive.google.com/drive/folders/${encodeURIComponent(settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
          >
            <span>Klasörü Aç</span>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        </div>

        {driveConnected ? (
          <div className="p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300 truncate">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{driveUserEmail || 'Google Drive Bağlı'}</span>
              </span>
              <button
                type="button"
                onClick={onDriveSignOut}
                title="Google oturumunu kapat"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-red-600 whitespace-nowrap"
              >
                <LogOut className="w-3 h-3" aria-hidden="true" />
                <span>Çıkış</span>
              </button>
            </div>
            {driveFolderName && (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 truncate">
                Hedef: <strong>{driveFolderName}</strong>/&lt;Anime Adı&gt;
              </p>
            )}
            {driveFolderWarning && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                {driveFolderWarning}
              </p>
            )}
            {pendingDriveCount > 0 && (
              <button
                type="button"
                disabled={isUploadingPendingDrive}
                onClick={onUploadPendingToDrive}
                className="w-full mt-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
              >
                {isUploadingPendingDrive ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>
                  {isUploadingPendingDrive
                    ? 'Yükleme Başlatılıyor...'
                    : `Bekleyen ${pendingDriveCount} Bölümü Yükle`}
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={isSyncingDrive}
              onClick={onDriveSyncFolder}
              className="w-full mt-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 disabled:opacity-50"
            >
              {isSyncingDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <FolderSync className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>
                {isSyncingDrive ? 'Klasör Taranıyor...' : 'Drive Klasörünü Kontrol Et'}
              </span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {(driveSessionExpired || pendingDriveCount > 0) && (
              <div className="p-2 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-[11px] text-amber-900 dark:text-amber-300 space-y-1">
                <div className="font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {driveSessionExpired
                      ? 'Drive Oturum Süresi Doldu'
                      : `${pendingDriveCount} Bölüm Drive Bekliyor`}
                  </span>
                </div>
                <p className="leading-snug opacity-90">
                  {driveUserEmail
                    ? `${driveUserEmail} ile tekrar bağlandığınızda bekleyen bölümler otomatik yüklenir.`
                    : 'Tekrar bağlandığınızda indirilmiş bekleyen bölümler otomatik yüklenir.'}
                </p>
              </div>
            )}
            {!driveSessionExpired && pendingDriveCount === 0 && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                İndirilen bölümlerin bilgisayarınıza inmeden doğrudan Drive klasörünüze aktarılması için bağlanın.
              </p>
            )}
            <GoogleSignInButton
              onClick={onDriveSignIn}
              disabled={isDriveLoggingIn}
              label={isDriveLoggingIn ? 'Bağlanılıyor...' : 'Sign in with Google'}
            />
            <button
              type="button"
              disabled={isSyncingDrive}
              onClick={onDriveSyncFolder}
              className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {isSyncingDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <FolderSync className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              )}
              <span>
                {isSyncingDrive ? 'Drive Taranıyor...' : 'Drive Klasörünü Kontrol Et'}
              </span>
            </button>
          </div>
        )}

        {driveSyncStatus && (driveSyncStatus.syncing || driveSyncStatus.lastSyncedAt) && (
          <div className="text-[11px] px-2.5 py-1.5 rounded-md bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-400">
            {driveSyncStatus.syncing ? (
              <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-medium">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                <span>Drive klasöründeki mevcut bölümler kontrol ediliyor...</span>
              </span>
            ) : (
              <span>
                Drive kontrolü: <strong>{driveSyncStatus.scannedFolders}</strong> klasör ·{' '}
                <strong>{driveSyncStatus.matchedFiles}</strong> bölüm eşleşti (tekrar indirilmez).
              </span>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor="drive-folder-input"
            className="block text-xs font-medium text-slate-600 dark:text-slate-400"
          >
            Drive Klasör Linki veya ID
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="drive-folder-input"
              type="text"
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="Drive klasör linki veya ID..."
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={applyDriveFolder}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              Uygula
            </button>
          </div>
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.driveAutoUpload}
            onChange={(e) => onUpdateSettings({ ...settings, driveAutoUpload: e.target.checked })}
            className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600"
          />
          <span className="text-xs leading-snug text-slate-700 dark:text-slate-300">
            İndirilince otomatik Drive&apos;a yükle
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.driveDeleteLocalAfterUpload}
            onChange={(e) =>
              onUpdateSettings({ ...settings, driveDeleteLocalAfterUpload: e.target.checked })
            }
            className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600"
          />
          <span className="text-xs leading-snug text-slate-700 dark:text-slate-300">
            Drive&apos;a yükleyince geçici dosyayı sil
          </span>
        </label>

        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed pt-1 border-t border-slate-100 dark:border-slate-800">
          Sayfayı yenileseniz veya kapatsanız da sunucu açık kaldıkça ve ~1 saatlik Google oturumu dolana kadar aktarım sürer. Süre dolarsa dosyalar sunucuda korunur, yeniden bağlanınca otomatik yüklenir.
        </p>
      </div>

      {/* İndirme Tercihleri */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            İndirme Tercihleri
          </h2>
          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Açık temaya geç' : 'Koyu temaya geç'}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="quality-mode-select"
            className="block text-xs font-medium text-slate-600 dark:text-slate-400"
          >
            Kalite Hedefi
          </label>
          <select
            id="quality-mode-select"
            value={qualityModeValue}
            onChange={(e) => {
              const val = Number(e.target.value) as 1080 | 720 | 0;
              onUpdateSettings({
                ...settings,
                minQualityHeight: val,
                strict1080p: val === 1080,
              });
            }}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            <option value="720">1080p Öncelikli (Yoksa 720p)</option>
            <option value="1080">Sadece 1080p Zorunlu</option>
            <option value="0">En Yüksek Kalite (Tümü)</option>
          </select>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
            Önce 1080p akış aranır; bulunamazsa 720p indirilir.
          </p>
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoFallbackSearch}
            onChange={(e) =>
              onUpdateSettings({ ...settings, autoFallbackSearch: e.target.checked })
            }
            className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600"
          />
          <span className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
            <strong className="block font-semibold text-slate-900 dark:text-slate-100">
              Eksik Linkleri Fansublardan Ara
            </strong>
            Bölüm linki yoksa veya açılmazsa harici fansubları otomatik tara.
          </span>
        </label>

        <div className="space-y-1.5">
          <label
            htmlFor="concurrency-select"
            className="block text-xs font-medium text-slate-600 dark:text-slate-400"
          >
            Eşzamanlı İndirme
          </label>
          <select
            id="concurrency-select"
            value={settings.maxConcurrency}
            onChange={(e) =>
              onUpdateSettings({ ...settings, maxConcurrency: Number(e.target.value) })
            }
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            <option value={1}>1 eşzamanlı indirme</option>
            <option value={2}>2 eşzamanlı indirme</option>
            <option value={4}>4 eşzamanlı indirme</option>
            <option value={5}>5 eşzamanlı indirme</option>
            <option value={8}>8 eşzamanlı indirme</option>
            <option value={10}>10 eşzamanlı indirme (Hızlı)</option>
            <option value={15}>15 eşzamanlı indirme (Toplu)</option>
            <option value={20}>20 eşzamanlı indirme (Maks.)</option>
          </select>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
            Aynı kaynağa en fazla 3 bağlantı açılarak HTTP 429 reddi önlenir.
          </p>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            Oynatıcı Öncelik Sırası
          </span>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            {settings.preferredPlayers.slice(0, 7).map((player, idx) => (
              <div
                key={player}
                className="flex items-center justify-between px-2.5 py-1.5 text-xs bg-slate-50/50 dark:bg-slate-950/40"
              >
                <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate">
                  {idx + 1}. {player}
                </span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => movePlayerPriority(idx, -1)}
                    aria-label={`${player} önceliğini artır`}
                    className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-30"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === settings.preferredPlayers.length - 1}
                    onClick={() => movePlayerPriority(idx, 1)}
                    aria-label={`${player} önceliğini düşür`}
                    className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-30"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
