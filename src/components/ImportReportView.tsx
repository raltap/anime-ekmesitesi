import { CheckCircle2, FileUp, Globe, Plus, RotateCcw, XCircle } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';

interface ImportReportViewProps {
  catalogCount: number;
  onImportReport: (
    rawText: string,
    mode: 'replace' | 'merge',
  ) => Promise<{ importedCount: number; skippedCount: number }>;
  onResetCatalog: () => Promise<number>;
  onAddManualEntry: (entry: {
    t: string;
    slug: string;
    fmt: string;
    yr: string;
    episode: string;
    fansub: string;
    player: string;
    embedUrl: string;
  }) => Promise<void>;
}

export function ImportReportView({
  catalogCount,
  onImportReport,
  onResetCatalog,
  onAddManualEntry,
}: ImportReportViewProps) {
  const [rawText, setRawText] = useState('');
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{
    type: 'ok' | 'error';
    text: string;
  } | null>(null);

  // Manual / Archive lookup form
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [episode, setEpisode] = useState('1');
  const [fansub, setFansub] = useState('Varsayılan');
  const [player, setPlayer] = useState('ODNOKLASSNIKI');
  const [embedUrl, setEmbedUrl] = useState('');
  const [manualFeedback, setManualFeedback] = useState<string | null>(null);

  // Live archive check
  const [lookupSlug, setLookupSlug] = useState('');
  const [lookupResult, setLookupResult] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    setImportFeedback(null);
  };

  const handleImportSubmit = async () => {
    setImportFeedback(null);
    if (!rawText.trim()) {
      setImportFeedback({
        type: 'error',
        text: 'Lütfen eksik_bolumler.html dosyasını seçin veya içeriği yapıştırın.',
      });
      return;
    }
    setImporting(true);
    try {
      const res = await onImportReport(rawText, importMode);
      setImportFeedback({
        type: 'ok',
        text: `${res.importedCount} anime kaydı başarıyla içe aktarıldı${
          res.skippedCount > 0 ? ` (${res.skippedCount} geçersiz satır atlandı)` : ''
        }.`,
      });
    } catch (err) {
      setImportFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Rapor ayrıştırılamadı.',
      });
    } finally {
      setImporting(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualFeedback(null);
    if (!title.trim() || !slug.trim() || !embedUrl.trim()) {
      setManualFeedback('Anime adı, slug ve oynatıcı URL alanları zorunludur.');
      return;
    }
    try {
      await onAddManualEntry({
        t: title.trim(),
        slug: slug.trim(),
        fmt: 'TV',
        yr: '2025',
        episode: episode.trim() || '1',
        fansub: fansub.trim() || 'Varsayılan',
        player: player.trim().toUpperCase(),
        embedUrl: embedUrl.trim(),
      });
      setManualFeedback('Kayıt kataloğa eklendi. Eksik Bölümler sekmesinden tarayıp indirebilirsiniz.');
      setTitle('');
      setSlug('');
      setEmbedUrl('');
    } catch (err) {
      setManualFeedback(err instanceof Error ? err.message : 'Eklenemedi.');
    }
  };

  const handleArchiveLookup = async () => {
    if (!lookupSlug.trim()) return;
    setLookingUp(true);
    setLookupResult(null);
    try {
      const res = await fetch('/api/archive/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: lookupSlug.trim() }),
      });
      const data = await res.json();
      if (data.found) {
        setLookupResult(`Arşivde bulundu: ${data.sourceUrl}`);
      } else {
        setLookupResult(
          `${data.message} Arşiv sayfası: ${data.archivePageUrl}`,
        );
      }
    } catch {
      setLookupResult('TürkAnime Arşivi bağlantısı başarısız oldu.');
    } finally {
      setLookingUp(false);
    }
  };

  return (
    <div className="space-y-6 flex-1 min-w-0 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
            Rapor İçe Aktar ve Kaynak Ekle
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Şu anda katalogda <strong className="font-mono">{catalogCount}</strong> anime kayıtlı. Güncel <code className="font-mono">eksik_bolumler.html</code> raporunuzu buraya yükleyebilirsiniz.
          </p>
        </div>
        <button
          type="button"
          disabled={resetting}
          onClick={async () => {
            setResetting(true);
            setImportFeedback(null);
            try {
              const count = await onResetCatalog();
              setImportFeedback({
                type: 'ok',
                text: `Katalog varsayılan başlangıç listesine (${count} anime) sıfırlandı.`,
              });
            } catch (err) {
              setImportFeedback({
                type: 'error',
                text: err instanceof Error ? err.message : 'Katalog sıfırlanamadı.',
              });
            } finally {
              setResetting(false);
            }
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{resetting ? 'Sıfırlanıyor...' : 'Varsayılan Kataloğa Sıfırla'}</span>
        </button>
      </div>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            HTML Raporu / JSON Yükle
          </h2>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setImportMode('replace')}
              className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                importMode === 'replace'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Listeyi Değiştir
            </button>
            <button
              type="button"
              onClick={() => setImportMode('merge')}
              className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                importMode === 'merge'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Mevcutla Birleştir
            </button>
          </div>
        </div>

        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-6 cursor-pointer hover:border-blue-500 dark:hover:border-blue-500 transition-colors bg-slate-50/50 dark:bg-slate-950/30">
          <FileUp className="w-6 h-6 text-slate-400" aria-hidden="true" />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            <code>eksik_bolumler.html</code> veya <code>.json</code> dosyası seçin
          </span>
          <input
            type="file"
            accept=".html,.htm,.json,.txt"
            onChange={handleFileUpload}
            className="sr-only"
          />
        </label>

        <div className="space-y-1.5">
          <label
            htmlFor="report-raw-textarea"
            className="block text-xs font-medium text-slate-600 dark:text-slate-400"
          >
            Veya HTML / <code className="font-mono">const R=[...]</code> / JSON içeriğini yapıştırın
          </label>
          <textarea
            id="report-raw-textarea"
            rows={5}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder='const R=[{"t":"Anime Adi","fmt":"TV",...}]; veya doğrudan JSON dizisi [...]'
            className="w-full p-3 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        {importFeedback && (
          <div
            role="status"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${
              importFeedback.type === 'ok'
                ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
            }`}
          >
            {importFeedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{importFeedback.text}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={importing}
            onClick={handleImportSubmit}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            {importing ? 'Ayrıştırılıyor...' : 'Raporu İçe Aktar'}
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <form
          onSubmit={handleManualSubmit}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3"
        >
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Manuel Eksik Bölüm & Link Ekle
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2">
              <label htmlFor="m-title" className="block text-xs text-slate-500 mb-1">
                Anime Adı
              </label>
              <input
                id="m-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Örn: Frieren"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="m-slug" className="block text-xs text-slate-500 mb-1">
                Slug
              </label>
              <input
                id="m-slug"
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="frieren"
                className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="m-ep" className="block text-xs text-slate-500 mb-1">
                Bölüm No
              </label>
              <input
                id="m-ep"
                type="text"
                value={episode}
                onChange={(e) => setEpisode(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="m-player" className="block text-xs text-slate-500 mb-1">
                Oynatıcı
              </label>
              <select
                id="m-player"
                value={player}
                onChange={(e) => setPlayer(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="ODNOKLASSNIKI">ODNOKLASSNIKI</option>
                <option value="SIBNET">SIBNET</option>
                <option value="MAIL">MAIL</option>
                <option value="SAVEFILEWAY">SAVEFILEWAY</option>
                <option value="MP4UPLOAD">MP4UPLOAD</option>
                <option value="SENDVID">SENDVID</option>
                <option value="VK">VK</option>
                <option value="VOE">VOE</option>
                <option value="UQLOAD">UQLOAD</option>
              </select>
            </div>
            <div>
              <label htmlFor="m-fansub" className="block text-xs text-slate-500 mb-1">
                Fansub
              </label>
              <input
                id="m-fansub"
                type="text"
                value={fansub}
                onChange={(e) => setFansub(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="col-span-2">
              <label htmlFor="m-url" className="block text-xs text-slate-500 mb-1">
                Embed URL
              </label>
              <input
                id="m-url"
                type="url"
                value={embedUrl}
                onChange={(e) => setEmbedUrl(e.target.value)}
                placeholder="https://odnoklassniki.ru/videoembed/..."
                className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {manualFeedback && (
            <p className="text-xs text-slate-600 dark:text-slate-300">{manualFeedback}</p>
          )}

          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Kataloğa Ekle</span>
          </button>
        </form>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            TürkAnime Arşivi Canlı Slug Sorgusu
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Arşivdeki yeni eklenmiş bölümleri kontrol etmek için anime slug&apos;ını girin.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="Arşiv slug sorgusu"
              value={lookupSlug}
              onChange={(e) => setLookupSlug(e.target.value)}
              placeholder="Örn: code-geass-hangyaku-no-lelouch"
              className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              disabled={lookingUp}
              onClick={handleArchiveLookup}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{lookingUp ? 'Sorgulanıyor...' : 'Sorgula'}</span>
            </button>
          </div>
          {lookupResult && (
            <p className="text-xs text-slate-600 dark:text-slate-300 break-all bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
              {lookupResult}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
