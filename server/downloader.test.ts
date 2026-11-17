import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AnimeEntry, DownloadJob, DownloadSettings } from '../src/shared/types.ts';
import { DownloadManager } from './downloader.ts';

function createDefaultSettings(overrides: Partial<DownloadSettings> = {}): DownloadSettings {
  return {
    strict1080p: false,
    minQualityHeight: 720,
    autoFallbackSearch: true,
    maxConcurrency: 2,
    preferredPlayers: ['OK.RU', 'ODNOKLASSNIKI', 'SIBNET', 'HDVID'],
    preferredFansubs: [],
    outputPattern: 'folder_per_anime',
    driveFolderId: '13YFkjFla33CLn4Vkvj_eC43I_9lGvaF-',
    driveAutoUpload: false,
    driveDeleteLocalAfterUpload: false,
    ...overrides,
  };
}

function makeTempWorkspace(): {
  dir: string;
  jobsFile: string;
  sampleMp4: string;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-downloader-test-'));
  const jobsFile = path.join(dir, 'jobs.json');
  const sampleMp4 = path.join(dir, 'sample-episode.mp4');
  fs.writeFileSync(sampleMp4, Buffer.from('fake-mp4-bytes'));
  return {
    dir,
    jobsFile,
    sampleMp4,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function makeJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  const now = Date.now();
  return {
    id: 'job-' + Math.random().toString(36).slice(2, 8),
    slug: 'banana-fish',
    animeTitle: 'Banana Fish',
    episode: '1',
    status: 'completed',
    strict1080p: false,
    minQualityHeight: 720,
    bytesDownloaded: 1024,
    totalBytes: 1024,
    speedBps: 0,
    percent: 100,
    attempts: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('DownloadManager tracks pending Drive uploads, missing local files, and auth-error expiry state', () => {
  const ws = makeTempWorkspace();
  try {
    const existingPendingJob = makeJob({
      id: 'job-existing-file',
      episode: '1',
      status: 'completed',
      driveStatus: 'error',
      driveError: 'Google Drive API hatası (HTTP 401): Invalid Credentials',
      filePath: ws.sampleMp4,
    });
    const missingFileJob = makeJob({
      id: 'job-missing-file',
      episode: '2',
      status: 'completed',
      driveStatus: 'pending',
      filePath: path.join(ws.dir, 'does-not-exist.mp4'),
    });
    const alreadyUploadedJob = makeJob({
      id: 'job-uploaded',
      episode: '3',
      status: 'completed',
      driveStatus: 'uploaded',
      driveWebViewLink: 'https://drive.google.com/file/d/abc/view',
      filePath: ws.sampleMp4,
    });

    fs.writeFileSync(
      ws.jobsFile,
      JSON.stringify([existingPendingJob, missingFileJob, alreadyUploadedJob], null, 2),
      'utf8',
    );

    const manager = new DownloadManager({
      getCatalog: () => [],
      getSettings: () => createDefaultSettings({ driveAutoUpload: false }),
      jobsFile: ws.jobsFile,
    });

    const jobs = manager.listJobs();
    const jobMap = new Map(jobs.map((j) => [j.id, j]));
    assert.equal(jobMap.get('job-existing-file')?.localFileExists, true);
    assert.equal(jobMap.get('job-missing-file')?.localFileExists, false);
    assert.equal(manager.getPendingDriveCount(), 1);
    assert.equal(manager.getMissingLocalDriveCount(), 1);

    // Setting meta + expired token preserves email/folder and reverts 401 error back to pending
    manager.setDriveSessionMeta({ userEmail: 'user@example.com', folderName: 'AnimeArsiv' });
    manager.markDriveTokenExpired();

    const expiredSummary = manager.getDriveSessionSummary();
    assert.equal(expiredSummary.connected, false);
    assert.equal(expiredSummary.expired, true);
    assert.equal(expiredSummary.userEmail, 'user@example.com');
    assert.equal(expiredSummary.folderName, 'AnimeArsiv');
    assert.equal(expiredSummary.pendingDriveCount, 1);
    assert.equal(expiredSummary.missingLocalDriveCount, 1);

    const updatedPendingJob = manager.getJob('job-existing-file');
    assert.equal(updatedPendingJob?.driveStatus, 'pending');
    assert.match(updatedPendingJob?.driveError || '', /oturum süresi/i);

    // Reconnecting with a token clears expired flag, while explicit sign-out clears user metadata
    manager.setDriveToken('fresh-access-token', { userEmail: 'user@example.com' });
    assert.equal(manager.hasDriveToken(), true);
    assert.equal(manager.getDriveSessionSummary().expired, false);
    assert.equal(manager.getDriveSessionSummary().connected, true);

    manager.setDriveToken(null);
    const signedOutSummary = manager.getDriveSessionSummary();
    assert.equal(signedOutSummary.connected, false);
    assert.equal(signedOutSummary.expired, false);
    assert.equal(signedOutSummary.userEmail, null);
    assert.equal(signedOutSummary.folderName, null);
  } finally {
    ws.cleanup();
  }
});

test('DownloadManager.requeueFailedJobs only re-queues failed jobs and leaves completed/cancelled jobs untouched', () => {
  const ws = makeTempWorkspace();
  let manager: DownloadManager | null = null;
  try {
    const failedJob1 = makeJob({
      id: 'failed-1',
      episode: '4',
      status: 'failed',
      error: 'Kaynak bulunamadı',
      percent: 0,
    });
    const failedJob2 = makeJob({
      id: 'failed-2',
      episode: '5',
      status: 'failed',
      error: 'Bağlantı koptu',
      percent: 42,
    });
    const completedJob = makeJob({
      id: 'done-1',
      episode: '1',
      status: 'completed',
      percent: 100,
    });
    const cancelledJob = makeJob({
      id: 'cancel-1',
      episode: '2',
      status: 'cancelled',
      percent: 10,
    });

    fs.writeFileSync(
      ws.jobsFile,
      JSON.stringify([failedJob1, failedJob2, completedJob, cancelledJob], null, 2),
      'utf8',
    );

    manager = new DownloadManager({
      getCatalog: () => [
        {
          slug: 'banana-fish',
          t: 'Banana Fish',
          fmt: 'TV',
          yr: 2018,
          ec: 24,
          E: 2,
          miss: ['4', '5'],
          at: '',
          d: 'kismi',
          f: {
            '4': [['TestSubs', 'OK.RU', 'http://127.0.0.1:9/embed-4']],
            '5': [['TestSubs', 'OK.RU', 'http://127.0.0.1:9/embed-5']],
          },
        },
      ],
      getSettings: () => createDefaultSettings({ autoFallbackSearch: false, maxConcurrency: 1 }),
      jobsFile: ws.jobsFile,
    });

    const count = manager.requeueFailedJobs();
    assert.equal(count, 2);

    const f1 = manager.getJob('failed-1');
    const f2 = manager.getJob('failed-2');
    const c1 = manager.getJob('done-1');
    const x1 = manager.getJob('cancel-1');
    assert.equal(f1?.error, undefined);
    assert.equal(f2?.error, undefined);
    assert.equal(f1?.status, 'probing');
    assert.equal(f2?.status, 'queued');
    assert.equal(c1?.status, 'completed');
    assert.equal(x1?.status, 'cancelled');
  } finally {
    manager?.cancelAll();
    ws.cleanup();
  }
});

test('DownloadManager reconciles stale jobs from Drive sync and prevents duplicate re-downloading', () => {
  const ws = makeTempWorkspace();
  let manager: DownloadManager | null = null;
  try {
    const staleFailedOnDrive = makeJob({
      id: 'stale-failed',
      slug: 'a-channel-a-channel',
      animeTitle: 'A-Channel: +A-Channel',
      episode: '10',
      status: 'failed',
      error: 'Kaynak bulunamadı',
    });
    const stalePausedOnDrive = makeJob({
      id: 'stale-paused',
      slug: 'ame-iro-cocoa',
      animeTitle: 'Ame-iro Cocoa',
      episode: '11',
      status: 'paused',
    });
    const actuallyFailed = makeJob({
      id: 'still-missing',
      slug: 'banana-fish',
      animeTitle: 'Banana Fish',
      episode: '4',
      status: 'failed',
      error: 'Hata',
    });

    fs.writeFileSync(
      ws.jobsFile,
      JSON.stringify([staleFailedOnDrive, stalePausedOnDrive, actuallyFailed], null, 2),
      'utf8',
    );

    const driveSet = new Set<string>(['a-channel-a-channel:10', 'ame-iro-cocoa:11']);
    const testCatalog: AnimeEntry[] = [
      {
        slug: 'a-channel-a-channel',
        t: 'A-Channel: +A-Channel',
        fmt: 'SPECIAL',
        yr: 2011,
        ec: 10,
        E: 11,
        miss: ['10'],
        at: '',
        d: 'tam',
        f: { '10': [['Test', 'OK.RU', 'http://127.0.0.1:9/10']] },
      },
      {
        slug: 'banana-fish',
        t: 'Banana Fish',
        fmt: 'TV',
        yr: 2018,
        ec: 23,
        E: 24,
        miss: ['4'],
        at: '',
        d: 'tam',
        f: { '4': [['Test', 'OK.RU', 'http://127.0.0.1:9/4']] },
      },
    ];
    manager = new DownloadManager({
      getCatalog: () => testCatalog,
      getSettings: () => createDefaultSettings({ autoFallbackSearch: false, maxConcurrency: 1 }),
      hasRecordedEpisode: (slug, ep) => driveSet.has(`${slug}:${ep}`),
      isEpisodeAlreadyOnDrive: (slug, ep) => driveSet.has(`${slug}:${ep}`),
      jobsFile: ws.jobsFile,
    });

    // Syncing Drive records turns stale failed/paused jobs into completed without downloading again
    const reconciled = manager.markEpisodesSyncedFromDrive([
      {
        key: 'a-channel-a-channel:10',
        slug: 'a-channel-a-channel',
        animeTitle: 'A-Channel: +A-Channel',
        episode: '10',
        quality: '1080p',
        resolutionHeight: 1080,
        player: 'GDRIVE',
        fansub: 'Unmei',
        fileName: 'A-Channel - Bolum 10 [1080p].mp4',
        totalBytes: 0,
        downloadedAt: Date.now(),
        driveFileId: 'drive10',
        driveWebViewLink: 'https://drive.google.com/file/d/drive10/view',
      },
      {
        key: 'ame-iro-cocoa:11',
        slug: 'ame-iro-cocoa',
        animeTitle: 'Ame-iro Cocoa',
        episode: '11',
        quality: '1080p',
        resolutionHeight: 1080,
        player: 'GDRIVE',
        fansub: 'Unmei',
        fileName: 'Ame-iro Cocoa - Bolum 11 [1080p].mp4',
        totalBytes: 0,
        downloadedAt: Date.now(),
        driveFileId: 'drive11',
        driveWebViewLink: 'https://drive.google.com/file/d/drive11/view',
      },
    ]);
    assert.equal(reconciled, 2);
    assert.equal(manager.getJob('stale-failed')?.status, 'completed');
    assert.equal(manager.getJob('stale-failed')?.driveStatus, 'uploaded');
    assert.equal(manager.getJob('stale-paused')?.status, 'completed');

    // Enqueueing an episode already in Drive/history is skipped by default
    const skippedRes = manager.enqueue([{ slug: 'a-channel-a-channel', episode: '10' }]);
    assert.equal(skippedRes.created.length, 0);
    assert.equal(skippedRes.skippedExisting, 1);

    // Only explicit forceRedownload creates a job for an already-archived episode
    const forcedRes = manager.enqueue(
      [{ slug: 'a-channel-a-channel', episode: '10' }],
      { forceRedownload: true },
    );
    assert.equal(forcedRes.created.length, 1);
    assert.equal(forcedRes.skippedExisting, 0);
  } finally {
    manager?.cancelAll();
    ws.cleanup();
  }
});
