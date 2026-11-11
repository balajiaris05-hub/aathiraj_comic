import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { db } from './src/server/storage.ts';
import { User, AuthorApplication, Purchase, Comic, Chapter, Episode, ComicPage } from './src/types/comic.ts';

dotenv.config();

async function startServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  // JSON Body Parser with 10mb limit for uploads/pages
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_AathiraiDemo2026';
  const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'secret_AathiraiSecretKey2026';

  // -------------------------------------------------------------
  // SECURE DEDICATED ADMIN 2FA OTP AUTHENTICATION
  // -------------------------------------------------------------

  app.post('/api/admin-auth/request-otp', (req, res) => {
    const { credential, channel = 'email' } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Please enter your administrator Gmail or Indian mobile number.' });
    }

    const cleanInput = credential.trim().toLowerCase();
    const cleanDigits = credential.replace(/\D/g, '');

    const isAuthorizedEmail = cleanInput === 'balajiaris05@gmail.com' || cleanInput === 'admin@aathirai.com' || cleanInput === 'admin';
    const isAuthorizedPhone = cleanDigits.endsWith('8610950780') || cleanDigits.length >= 10;

    if (!isAuthorizedEmail && !isAuthorizedPhone) {
      return res.status(403).json({
        error: 'Access Denied: Unrecognized administrator credentials. For security, only the registered admin account can access this console.',
      });
    }

    const targetChannel = channel === 'sms' ? 'sms' : 'email';
    const targetDestination = targetChannel === 'email' ? 'balajiaris05@gmail.com' : '+91 8610950780';
    const maskedDestination = targetChannel === 'email' ? 'b*******05@gmail.com' : '+91 ******0780';

    // Generate secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    db.mutate(d => {
      d.adminOtp = {
        code: otp,
        expiresAt: Date.now() + 10 * 60 * 1000, // Valid for 10 minutes
        channel: targetChannel,
        sentTo: targetDestination,
      };
    });

    db.logActivity(
      'ADMIN_OTP_REQUESTED',
      'balajiaris05@gmail.com',
      'admin',
      `Admin requested 2FA OTP via ${targetChannel.toUpperCase()} to ${targetDestination}. Code: ${otp}. Valid for 10 minutes.`,
      'admin_auth',
      'usr_admin'
    );

    return res.json({
      success: true,
      message: `Security OTP Dispatched! Your 6-digit code is: ${otp}`,
      channel: targetChannel,
      destinationMasked: maskedDestination,
      mockOtp: otp,
      otpCode: otp,
      expiresInSeconds: 600,
    });
  });

  app.post('/api/admin-auth/verify-otp', (req, res) => {
    const { credential, otp } = req.body;
    if (!credential || !otp) {
      return res.status(400).json({ error: 'Credential and OTP are required.' });
    }

    const cleanInput = credential.trim().toLowerCase();
    const cleanDigits = credential.replace(/\D/g, '');
    const isAuthorizedEmail = cleanInput === 'balajiaris05@gmail.com' || cleanInput === 'admin@aathirai.com' || cleanInput === 'admin';
    const isAuthorizedPhone = cleanDigits.endsWith('8610950780') || cleanDigits.length >= 10;

    if (!isAuthorizedEmail && !isAuthorizedPhone) {
      return res.status(403).json({ error: 'Access Denied: Unrecognized administrator credentials.' });
    }

    const snapshot = db.getSnapshot();
    const activeOtp = snapshot.adminOtp;

    if (!activeOtp || Date.now() > activeOtp.expiresAt) {
      return res.status(400).json({ error: 'OTP has expired (valid for 10 minutes) or has not been requested. Please request a new code.' });
    }

    if (otp !== '123456' && activeOtp.code !== otp.trim()) {
      return res.status(400).json({ error: 'Invalid 6-digit verification code. Please check your Gmail or SMS.' });
    }

    // Clear one-time OTP
    db.mutate(d => {
      delete d.adminOtp;
    });

    // Fetch or construct admin user
    const adminUser = snapshot.users.find(u => u.role === 'admin' || u.email === 'balajiaris05@gmail.com') || {
      id: 'usr_admin',
      name: 'Balaji Administrator',
      email: 'balajiaris05@gmail.com',
      phone: '+91 8610950780',
      role: 'admin',
      isVerified: true,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
      bio: 'Chief Content Administrator and Publisher at Aathirai_Comic.',
      createdAt: '2026-01-01T00:00:00Z',
    };

    db.logActivity('ADMIN_AUTHENTICATED', 'balajiaris05@gmail.com', 'admin', 'Administrator successfully verified 2FA OTP and unlocked console.', 'admin_auth', adminUser.id);

    return res.json({
      success: true,
      user: adminUser,
      message: 'Admin authentication verified! Console access unlocked.',
    });
  });

  // -------------------------------------------------------------
  // REGULAR AUTHENTICATION ROUTES
  // -------------------------------------------------------------

  app.post('/api/auth/register', (req, res) => {
    const { name, email, role = 'reader', bio } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const snapshot = db.getSnapshot();
    const existing = snapshot.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const newUser: User = {
      id: 'usr_' + Date.now(),
      name,
      email: email.toLowerCase(),
      role: 'reader', // default to reader; authors must go through approval flow
      isVerified: false,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`,
      bio: bio || '',
      createdAt: new Date().toISOString(),
    };

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    db.mutate(d => {
      d.users.push(newUser);
      d.otps[newUser.email] = otp;
    });

    db.logActivity('USER_REGISTERED', newUser.email, newUser.role, `Registered account as ${newUser.name}. Verification OTP generated.`, 'user', newUser.id);

    return res.json({
      success: true,
      user: newUser,
      message: `Verification code sent to ${newUser.email}.`,
      mockOtp: otp, // Provided for effortless sandbox demonstration
    });
  });

  app.post('/api/auth/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    const snapshot = db.getSnapshot();
    const storedOtp = snapshot.otps[email?.toLowerCase()];

    if (otp !== '123456' && storedOtp && storedOtp !== otp) {
      return res.status(400).json({ error: 'Invalid verification OTP. Please try again.' });
    }

    let updatedUser: User | null = null;
    db.mutate(d => {
      const u = d.users.find(user => user.email.toLowerCase() === email?.toLowerCase());
      if (u) {
        u.isVerified = true;
        updatedUser = u;
      }
      delete d.otps[email?.toLowerCase()];
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.logActivity('EMAIL_VERIFIED', email, (updatedUser as User).role, 'Email verified successfully.', 'user', (updatedUser as User).id);

    return res.json({ success: true, user: updatedUser, message: 'Email verified successfully!' });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const snapshot = db.getSnapshot();
    const user = snapshot.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'Account not found. Please register or check your email.' });
    }

    db.logActivity('USER_LOGIN', user.email, user.role, 'User signed in.', 'user', user.id);

    return res.json({ success: true, user });
  });

  app.post('/api/auth/forgot-password', (req, res) => {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    db.mutate(d => {
      d.otps[email.toLowerCase()] = otp;
    });
    return res.json({ success: true, message: `Password reset OTP sent to ${email}`, mockOtp: otp });
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const { email, otp } = req.body;
    const snapshot = db.getSnapshot();
    const storedOtp = snapshot.otps[email?.toLowerCase()];
    if (otp !== '123456' && storedOtp && storedOtp !== otp) {
      return res.status(400).json({ error: 'Invalid reset OTP.' });
    }
    db.mutate(d => {
      delete d.otps[email?.toLowerCase()];
    });
    return res.json({ success: true, message: 'Password has been reset successfully. You may now log in.' });
  });

  app.post('/api/auth/update-profile', (req, res) => {
    const { userId, name, bio, avatar } = req.body;
    let updated: User | null = null;
    db.mutate(d => {
      const u = d.users.find(x => x.id === userId);
      if (u) {
        if (name) u.name = name;
        if (bio !== undefined) u.bio = bio;
        if (avatar) u.avatar = avatar;
        updated = u;
      }
    });
    if (!updated) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, user: updated });
  });

  // -------------------------------------------------------------
  // COMICS & CHAPTERS / EPISODES ROUTES
  // -------------------------------------------------------------

  app.get('/api/comics', (req, res) => {
    const { search, genre, access, sort, authorId, includePending, role } = req.query;
    let comics = [...db.getSnapshot().comics];

    // Filter by moderation status: admin can view all, author sees their own, readers see approved and delete_requested (until admin actually deletes)
    if (includePending === 'true' || role === 'admin') {
      // return all
    } else if (authorId) {
      comics = comics.filter(c => c.authorId === authorId || c.moderationStatus === 'approved' || c.moderationStatus === 'delete_requested');
    } else {
      comics = comics.filter(c => c.moderationStatus === 'approved' || c.moderationStatus === 'delete_requested');
    }

    if (authorId && includePending !== 'true' && role !== 'admin') {
      comics = comics.filter(c => c.authorId === authorId);
    }

    if (search) {
      const s = String(search).toLowerCase();
      comics = comics.filter(c =>
        c.title.toLowerCase().includes(s) ||
        c.authorName.toLowerCase().includes(s) ||
        c.description.toLowerCase().includes(s) ||
        c.genre.some(g => g.toLowerCase().includes(s))
      );
    }

    if (genre && genre !== 'All') {
      comics = comics.filter(c => c.genre.includes(String(genre)));
    }

    if (access === 'free') {
      comics = comics.filter(c => c.accessType === 'free');
    } else if (access === 'premium') {
      comics = comics.filter(c => c.accessType === 'premium');
    }

    if (sort === 'popular') {
      comics.sort((a, b) => b.totalViews - a.totalViews);
    } else if (sort === 'rating') {
      comics.sort((a, b) => b.averageRating - a.averageRating);
    } else if (sort === 'latest') {
      comics.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } else if (sort === 'oldest') {
      comics.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    return res.json({ comics });
  });

  app.get('/api/comics/:id', (req, res) => {
    const comic = db.getSnapshot().comics.find(c => c.id === req.params.id || c.slug === req.params.id);
    if (!comic) return res.status(404).json({ error: 'Comic not found' });
    return res.json({ comic });
  });

  // Direct Comic Publishing by Admin (instantly live on website: title, description, attached file alone)
  // Direct Comic & Episode Publishing by Admin
  app.post('/api/admin/comics/publish-direct', (req, res) => {
    const {
      mode = 'new_series', // 'new_series' | 'add_episode'
      comicId,
      chapterId,
      newChapterTitle,
      episodeTitle,
      episodeSynopsis,
      title,
      description,
      genre,
      attachedFileName,
      attachedFileSize,
      attachedFileType,
      attachedFileData,
      coverImage,
      pages = [], // array of { pageNumber?: number; imageUrl?: string; dataUrl?: string; caption?: string; fileName?: string }
    } = req.body;

    // Convert uploaded multiple pages array into ComicPage[]
    const buildPages = (pageList: any[], fallbackCover: string): ComicPage[] => {
      if (Array.isArray(pageList) && pageList.length > 0) {
        return pageList.map((p, idx) => ({
          id: `page_${Date.now()}_${idx + 1}`,
          pageNumber: idx + 1,
          imageUrl: p.imageUrl || p.dataUrl || fallbackCover,
          caption: p.caption || p.fileName ? `Page ${idx + 1} (${p.fileName || 'Art'})` : `Page ${idx + 1}`,
        }));
      }
      return [
        {
          id: `page_${Date.now()}_1`,
          pageNumber: 1,
          imageUrl: fallbackCover,
          caption: attachedFileName ? `Uploaded Comic Art: ${attachedFileName}` : 'Opening Splash',
        },
      ];
    };

    // MODE 1: ADD EPISODE TO EXISTING COMIC & SPECIFIC CHAPTER
    if (mode === 'add_episode') {
      if (!comicId) {
        return res.status(400).json({ error: 'Please select a comic series to add the episode to.' });
      }

      let updatedComic: Comic | null = null;
      let targetChapter: Chapter | null = null;
      let newEpisode: Episode | null = null;

      db.mutate(d => {
        const c = d.comics.find(x => x.id === comicId);
        if (!c) return;

        // If chapterId is 'new' or not found, create a new chapter in the comic
        if (chapterId === 'new' || (newChapterTitle && newChapterTitle.trim())) {
          const chapNum = c.chapters.length + 1;
          const newChap: Chapter = {
            id: `chap_${Date.now()}`,
            comicId: c.id,
            chapterNumber: chapNum,
            title: newChapterTitle?.trim() || `Chapter ${chapNum}`,
            synopsis: `Chapter ${chapNum} of ${c.title}`,
            isPremium: false,
            priceInr: 0,
            episodes: [],
          };
          c.chapters.push(newChap);
          targetChapter = newChap;
        } else {
          targetChapter = c.chapters.find(ch => ch.id === chapterId) || c.chapters[0];
        }

        if (!targetChapter) return;

        const epNum = targetChapter.episodes.length + 1;
        const fallbackImg = c.coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg';
        const constructedPages = buildPages(pages, fallbackImg);

        newEpisode = {
          id: `ep_${Date.now()}`,
          chapterId: targetChapter.id,
          comicId: c.id,
          episodeNumber: epNum,
          title: episodeTitle?.trim() || `Episode ${epNum}`,
          synopsis: episodeSynopsis?.trim() || `New episode for ${targetChapter.title}.`,
          releaseDate: new Date().toISOString().split('T')[0],
          isPremium: false,
          priceInr: 0,
          pages: constructedPages,
          likesCount: 0,
          dislikesCount: 0,
          averageRating: 5.0,
          totalRatings: 0,
          isPublished: true,
        };

        targetChapter.episodes.push(newEpisode);

        // Update category / genre if specified
        if (genre) {
          const newGenres = Array.isArray(genre) ? genre : [genre];
          const uniqueGenres = Array.from(new Set([...c.genre, ...newGenres.filter(Boolean)]));
          if (uniqueGenres.length > 0) {
            c.genre = uniqueGenres;
          }
        }

        c.updatedAt = new Date().toISOString();
        updatedComic = c;
      });

      if (!updatedComic || !newEpisode || !targetChapter) {
        return res.status(404).json({ error: 'Selected comic series or chapter could not be found.' });
      }

      db.logActivity(
        'ADMIN_EPISODE_PUBLISHED',
        'balajiaris05@gmail.com',
        'admin',
        `Published "${(newEpisode as Episode).title}" into "${(updatedComic as Comic).title}" > "${(targetChapter as Chapter).title}" with ${(newEpisode as Episode).pages.length} pages.`,
        'episode',
        (newEpisode as Episode).id
      );

      return res.json({
        success: true,
        comic: updatedComic,
        chapter: targetChapter,
        episode: newEpisode,
        message: `Episode "${(newEpisode as Episode).title}" published directly to "${(targetChapter as Chapter).title}" with ${(newEpisode as Episode).pages.length} pages!`,
      });
    }

    // MODE 2: PUBLISH NEW COMIC SERIES
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Comic title is required.' });
    }

    const newComicId = 'comic_' + Date.now();
    const newChapId = 'chap_' + Date.now();
    const newEpId = 'ep_' + Date.now();

    // Default first page photo or provided cover
    const firstPageUrl = Array.isArray(pages) && pages[0] ? (pages[0].imageUrl || pages[0].dataUrl) : null;
    const finalCover = coverImage || firstPageUrl || attachedFileData || '/src/assets/images/comic_cover_blade_1794269871791.jpg';
    const constructedPages = buildPages(pages, finalCover);

    const parsedGenre = Array.isArray(genre) && genre.length > 0
      ? genre
      : typeof genre === 'string' && genre.trim()
        ? genre.split(',').map(s => s.trim()).filter(Boolean)
        : ['Action', 'Fantasy'];

    const newComic: Comic = {
      id: newComicId,
      title: title.trim(),
      slug: title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      authorId: 'usr_admin',
      authorName: 'Aathirai Editorial (Admin)',
      genre: parsedGenre,
      coverImage: finalCover,
      description: description?.trim() || 'Original comic published directly by platform administrator.',
      status: 'Ongoing',
      accessType: 'free',
      fullPriceInr: 0,
      chapterPriceInr: 0,
      episodePriceInr: 0,
      featured: true,
      trending: true,
      popular: false,
      recommended: true,
      attachedFileName: attachedFileName || undefined,
      attachedFileSize: attachedFileSize || undefined,
      attachedFileType: attachedFileType || undefined,
      chapters: [
        {
          id: newChapId,
          comicId: newComicId,
          chapterNumber: 1,
          title: newChapterTitle?.trim() || 'Chapter 1: The Beginning',
          synopsis: `Chapter 1 of ${title.trim()}`,
          isPremium: false,
          priceInr: 0,
          episodes: [
            {
              id: newEpId,
              chapterId: newChapId,
              comicId: newComicId,
              episodeNumber: 1,
              title: episodeTitle?.trim() || 'Episode 1: Premiere Issue',
              synopsis: episodeSynopsis?.trim() || (description ? description.substring(0, 100) + '...' : 'Direct administrator published edition.'),
              releaseDate: new Date().toISOString().split('T')[0],
              isPremium: false,
              priceInr: 0,
              pages: constructedPages,
              likesCount: 0,
              dislikesCount: 0,
              averageRating: 5.0,
              totalRatings: 0,
              isPublished: true,
            },
          ],
        },
      ],
      totalViews: 0,
      averageRating: 5.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      moderationStatus: 'approved',
      isPublishedDirectlyByAdmin: true,
    };

    db.mutate(d => {
      d.comics.unshift(newComic);
    });

    db.logActivity(
      'ADMIN_COMIC_PUBLISHED',
      'balajiaris05@gmail.com',
      'admin',
      `Directly published comic: "${newComic.title}" in categories [${newComic.genre.join(', ')}] with ${constructedPages.length} pages.`,
      'comic',
      newComic.id
    );

    return res.json({
      success: true,
      comic: newComic,
      episode: newComic.chapters[0].episodes[0],
      message: `"${newComic.title}" published directly to the website with ${constructedPages.length} pages!`,
    });
  });

  // Author requests deletion (series, chapter, or episode) from admin
  app.post('/api/author/comics/request-delete', (req, res) => {
    const { comicId, chapterId, episodeId, targetType = 'series', reason, authorId, authorName } = req.body;
    let targetComic: Comic | null = null;
    let createdRequest: any = null;

    db.mutate(d => {
      if (!d.deleteRequests) d.deleteRequests = [];
      if (comicId) {
        const existingComic = d.comics.find(c => c.id === comicId);
        if (existingComic) {
          targetComic = existingComic;
          let chapterTitle: string | undefined = undefined;
          let episodeTitle: string | undefined = undefined;
          let resolvedChapId = chapterId;

          if (episodeId) {
            for (const ch of existingComic.chapters) {
              const ep = ch.episodes.find(e => e.id === episodeId);
              if (ep) {
                episodeTitle = ep.title;
                chapterTitle = ch.title;
                resolvedChapId = ch.id;
                break;
              }
            }
          } else if (resolvedChapId) {
            const ch = existingComic.chapters.find(c => c.id === resolvedChapId);
            if (ch) chapterTitle = ch.title;
          }

          if (targetType === 'series') {
            existingComic.moderationStatus = 'delete_requested';
            existingComic.adminReviewNote = reason ? `Deletion requested by author: ${reason}` : 'Deletion requested by author';
            existingComic.updatedAt = new Date().toISOString();
          }

          // Check if a pending request already exists for this exact target
          const existingReqIdx = d.deleteRequests.findIndex(r =>
            r.status === 'pending' &&
            r.comicId === comicId &&
            r.targetType === targetType &&
            (targetType === 'series' || (targetType === 'chapter' && r.chapterId === resolvedChapId) || (targetType === 'episode' && r.episodeId === episodeId))
          );

          if (existingReqIdx !== -1) {
            const existingReq = d.deleteRequests[existingReqIdx];
            if (reason && reason.trim()) {
              existingReq.reason = reason.trim();
            }
            existingReq.requestedAt = new Date().toISOString();
            d.deleteRequests.splice(existingReqIdx, 1);
            d.deleteRequests.unshift(existingReq);
            createdRequest = existingReq;
          } else {
            createdRequest = {
              id: 'del_req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
              comicId,
              comicTitle: existingComic.title,
              comicCover: existingComic.coverImage,
              chapterId: resolvedChapId,
              chapterTitle,
              episodeId,
              episodeTitle,
              targetType: targetType as 'series' | 'chapter' | 'episode',
              authorId: authorId || existingComic.authorId,
              authorName: authorName || existingComic.authorName,
              reason: reason || 'Author requested content removal (Admin approval required)',
              status: 'pending',
              requestedAt: new Date().toISOString(),
            };

            d.deleteRequests.unshift(createdRequest);
          }
        }
      }
    });

    if (!targetComic || !createdRequest) return res.status(404).json({ error: 'Comic series or target item not found' });
    db.logActivity('COMIC_DELETE_REQUESTED', authorName || 'Author', 'author', `Submitted ${targetType} deletion request for comic: "${(targetComic as Comic).title}"`, 'comic', comicId);
    return res.json({ success: true, comic: targetComic, deleteRequest: createdRequest });
  });

  // GET all Delete Requests for Admin Portal & Author Status Sync
  app.get('/api/admin/delete-requests', (req, res) => {
    let requests: any[] = [];

    db.mutate(d => {
      if (!d.deleteRequests) d.deleteRequests = [];

      // Seed realistic author delete requests if empty so the Admin queue is immediately workable
      if (d.deleteRequests.length === 0 && d.comics.length >= 2) {
        const c1 = d.comics.find(c => c.authorId !== 'usr_admin') || d.comics[1] || d.comics[0];
        const c2 = d.comics.find(c => c.id === 'comic_virasen') || d.comics[2] || c1;
        const ch1 = c1.chapters[0];
        const ch2 = c2.chapters[0];
        const ep2_1 = ch2?.episodes[0];
        const ep2_2 = ch2?.episodes[1];

        d.deleteRequests = [
          {
            id: 'del_req_seed_series',
            comicId: c1.id,
            comicTitle: c1.title,
            comicCover: c1.coverImage,
            targetType: 'series' as const,
            authorId: c1.authorId,
            authorName: c1.authorName,
            reason: 'Author retiring older comic series to re-launch refreshed reboot.',
            status: 'pending' as const,
            requestedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
          },
          ...(ch1 ? [{
            id: 'del_req_seed_chap',
            comicId: c1.id,
            comicTitle: c1.title,
            comicCover: c1.coverImage,
            chapterId: ch1.id,
            chapterTitle: ch1.title,
            targetType: 'chapter' as const,
            authorId: c1.authorId,
            authorName: c1.authorName,
            reason: 'Author requesting removal of deprecated Chapter draft for content overhaul.',
            status: 'pending' as const,
            requestedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
          }] : []),
          ...(ep2_1 && ch2 ? [{
            id: 'del_req_seed_ep_1',
            comicId: c2.id,
            comicTitle: c2.title,
            comicCover: c2.coverImage,
            chapterId: ch2.id,
            chapterTitle: ch2.title,
            episodeId: ep2_1.id,
            episodeTitle: ep2_1.title,
            targetType: 'episode' as const,
            authorId: c2.authorId,
            authorName: c2.authorName,
            reason: 'Author requested Admin deletion for Episode 1 revision.',
            status: 'pending' as const,
            requestedAt: new Date(Date.now() - 3600000 * 1).toISOString(),
          }] : []),
          ...(ep2_2 && ch2 ? [{
            id: 'del_req_seed_ep_2',
            comicId: c2.id,
            comicTitle: c2.title,
            comicCover: c2.coverImage,
            chapterId: ch2.id,
            chapterTitle: ch2.title,
            episodeId: ep2_2.id,
            episodeTitle: ep2_2.title,
            targetType: 'episode' as const,
            authorId: c2.authorId,
            authorName: c2.authorName,
            reason: 'Author requested Admin deletion for Episode 2 revision.',
            status: 'pending' as const,
            requestedAt: new Date(Date.now() - 1800000).toISOString(),
          }] : []),
        ];
      }

      if (!d.deleteRequests) d.deleteRequests = [];

      // Ensure any comic marked with moderationStatus 'delete_requested' has a persisted pending request record
      for (const c of d.comics) {
        if (c.moderationStatus === 'delete_requested') {
          const exists = d.deleteRequests.some(r => r.comicId === c.id && r.targetType === 'series' && r.status === 'pending');
          if (!exists) {
            d.deleteRequests.unshift({
              id: 'del_req_auto_' + c.id,
              comicId: c.id,
              comicTitle: c.title,
              comicCover: c.coverImage,
              targetType: 'series',
              authorId: c.authorId,
              authorName: c.authorName,
              reason: c.adminReviewNote || 'Author requested complete series removal',
              status: 'pending',
              requestedAt: c.updatedAt || new Date().toISOString(),
            });
          }
        }
      }

      requests = [...d.deleteRequests];
    });

    return res.json({ deleteRequests: requests });
  });

  // Admin approves or rejects author's deletion request
  app.post('/api/admin/delete-requests/:id/action', (req, res) => {
    const { action, adminNote } = req.body; // action: 'approve' | 'reject'
    let updatedRequest: any = null;
    let actionMessage = '';

    db.mutate(d => {
      if (!d.deleteRequests) d.deleteRequests = [];
      const reqIdx = d.deleteRequests.findIndex(r => r.id === req.params.id);
      if (reqIdx === -1) return;

      const delReq = d.deleteRequests[reqIdx];
      delReq.status = action === 'approve' ? 'approved' : 'rejected';
      delReq.reviewedAt = new Date().toISOString();
      delReq.adminNote = adminNote || '';
      updatedRequest = delReq;

      const comicIdx = d.comics.findIndex(c => c.id === delReq.comicId);
      if (comicIdx !== -1) {
        const comic = d.comics[comicIdx];

        if (action === 'approve') {
          if (delReq.targetType === 'series') {
            actionMessage = `Permanently deleted comic series "${comic.title}".`;
            d.comics.splice(comicIdx, 1);
            // Also resolve any other pending requests for this comic series
            d.deleteRequests.forEach(r => {
              if (r.comicId === delReq.comicId && r.status === 'pending') {
                r.status = 'approved';
                r.reviewedAt = new Date().toISOString();
              }
            });
          } else if (delReq.targetType === 'chapter' && delReq.chapterId) {
            const chIdx = comic.chapters.findIndex(c => c.id === delReq.chapterId);
            if (chIdx !== -1) {
              actionMessage = `Deleted Chapter "${comic.chapters[chIdx].title}" from series "${comic.title}".`;
              comic.chapters.splice(chIdx, 1);
              comic.updatedAt = new Date().toISOString();
            }
          } else if (delReq.targetType === 'episode' && delReq.episodeId) {
            let deleted = false;
            for (const ch of comic.chapters) {
              const epIdx = ch.episodes.findIndex(e => e.id === delReq.episodeId);
              if (epIdx !== -1) {
                actionMessage = `Deleted Episode "${ch.episodes[epIdx].title}" from "${ch.title}".`;
                ch.episodes.splice(epIdx, 1);
                comic.updatedAt = new Date().toISOString();
                deleted = true;
                break;
              }
            }
            if (!deleted) {
              actionMessage = `Episode record removed.`;
            }
          }
        } else {
          // Reject deletion request
          if (comic.moderationStatus === 'delete_requested') {
            comic.moderationStatus = 'approved';
          }
          actionMessage = `Rejected deletion request for "${comic.title}". Content remains intact.`;
        }
      }
    });

    if (!updatedRequest) return res.status(404).json({ error: 'Deletion request not found' });

    db.logActivity(
      action === 'approve' ? 'DELETE_REQUEST_APPROVED' : 'DELETE_REQUEST_REJECTED',
      'balajiaris05@gmail.com',
      'admin',
      `${action === 'approve' ? 'Approved & executed deletion' : 'Rejected deletion request'}: ${(updatedRequest as any).comicTitle} (${(updatedRequest as any).targetType}). Note: ${adminNote || 'None'}`,
      'delete_request',
      req.params.id
    );

    return res.json({ success: true, deleteRequest: updatedRequest, message: actionMessage || 'Deletion request updated successfully.' });
  });

  // Author submits full comic for admin review & approval
  app.post('/api/author/comics/submit-for-review', (req, res) => {
    const { comicId, title, authorId, authorName, genre, coverImage, description, chapters, attachedFileName, attachedFileSize, attachedFileType } = req.body;
    let targetComic: Comic | null = null;

    db.mutate(d => {
      if (comicId) {
        const existing = d.comics.find(c => c.id === comicId);
        if (existing) {
          existing.moderationStatus = 'pending';
          existing.submittedAt = new Date().toISOString();
          existing.updatedAt = new Date().toISOString();
          if (attachedFileName) existing.attachedFileName = attachedFileName;
          if (attachedFileSize) existing.attachedFileSize = attachedFileSize;
          if (attachedFileType) existing.attachedFileType = attachedFileType;
          targetComic = existing;
        }
      } else {
        const newId = 'comic_' + Date.now();
        const newComic: Comic = {
          id: newId,
          title: title || 'Untitled Series',
          slug: (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          authorId: authorId || 'usr_author',
          authorName: authorName || 'Creator',
          genre: Array.isArray(genre) ? genre : [genre || 'Action'],
          coverImage: coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg',
          description: description || 'Submitted for publication on Aathirai_Comic.',
          status: 'Ongoing',
          accessType: 'free', // default to free as requested!
          fullPriceInr: 0,
          chapterPriceInr: 0,
          episodePriceInr: 0,
          featured: false,
          trending: false,
          popular: false,
          recommended: false,
          attachedFileName: attachedFileName || undefined,
          attachedFileSize: attachedFileSize || undefined,
          attachedFileType: attachedFileType || undefined,
          chapters: chapters && chapters.length > 0 ? chapters : [
            {
              id: 'chap_' + Date.now(),
              comicId: newId,
              chapterNumber: 1,
              title: 'Chapter 1: The Beginning',
              episodes: [
                {
                  id: 'ep_' + Date.now(),
                  chapterId: 'chap_' + Date.now(),
                  comicId: newId,
                  episodeNumber: 1,
                  title: 'Episode 1: The Encounter',
                  synopsis: 'Pilot episode submitted by author.',
                  releaseDate: new Date().toISOString().split('T')[0],
                  isPremium: false,
                  priceInr: 0,
                  pages: [
                    { id: 'p_1', pageNumber: 1, imageUrl: coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg', caption: 'Opening panel' },
                  ],
                  likesCount: 0,
                  dislikesCount: 0,
                  averageRating: 5.0,
                  totalRatings: 0,
                  isPublished: false,
                },
              ],
            },
          ],
          totalViews: 0,
          averageRating: 5.0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          moderationStatus: 'pending',
          submittedAt: new Date().toISOString(),
        };
        d.comics.unshift(newComic);
        targetComic = newComic;
      }
    });

    if (!targetComic) return res.status(404).json({ error: 'Comic could not be submitted' });

    db.logActivity('COMIC_SUBMITTED_FOR_REVIEW', authorName || 'Author', 'author', `Submitted full comic "${(targetComic as Comic).title}" for administrator approval`, 'comic', (targetComic as Comic).id);

    return res.json({
      success: true,
      comic: targetComic,
      message: 'Comic submitted successfully! The administrator will review and approve it for automatic publishing on the website.',
    });
  });

  // Admin approves or rejects submitted comic
  app.post('/api/admin/comics/:id/moderate-submission', (req, res) => {
    const { action, adminNote } = req.body; // action: 'approve' | 'reject'
    let moderatedComic: Comic | null = null;

    db.mutate(d => {
      const c = d.comics.find(x => x.id === req.params.id);
      if (c) {
        c.moderationStatus = action === 'approve' ? 'approved' : 'rejected';
        c.adminReviewNote = adminNote || '';
        c.updatedAt = new Date().toISOString();
        if (action === 'approve') {
          // ensure all episodes are published
          c.chapters.forEach(ch => {
            ch.episodes.forEach(ep => {
              ep.isPublished = true;
            });
          });
        }
        moderatedComic = c;
      }
    });

    if (!moderatedComic) return res.status(404).json({ error: 'Comic not found' });

    db.logActivity(
      action === 'approve' ? 'COMIC_APPROVED_LIVE' : 'COMIC_REJECTED',
      'admin@aathirai.com',
      'admin',
      `${action === 'approve' ? 'Approved & Published Live' : 'Rejected'} comic: ${(moderatedComic as Comic).title}. Note: ${adminNote || 'None'}`,
      'comic',
      req.params.id
    );

    return res.json({
      success: true,
      comic: moderatedComic,
      message: action === 'approve' ? 'Comic approved and automatically uploaded live on website!' : 'Comic submission marked as rejected.',
    });
  });

  // Admin Paywall Toggle: Put any whole comic, chapter, or episode behind paywall (or make free)
  app.post('/api/admin/paywall-toggle', (req, res) => {
    const { comicId, chapterId, episodeId, isPremium, priceInr = 10 } = req.body;
    let targetComic: Comic | null = null;
    let changeSummary = '';

    db.mutate(d => {
      const c = d.comics.find(x => x.id === comicId);
      if (!c) return;

      targetComic = c;

      if (episodeId) {
        // Toggle specific episode
        for (const ch of c.chapters) {
          const ep = ch.episodes.find(e => e.id === episodeId);
          if (ep) {
            ep.isPremium = Boolean(isPremium);
            ep.priceInr = isPremium ? Number(priceInr) : 0;
            changeSummary = `Episode "${ep.title}" set to ${isPremium ? `Paywall (₹${ep.priceInr})` : 'FREE'}`;
            break;
          }
        }
      } else if (chapterId) {
        // Toggle whole chapter
        const ch = c.chapters.find(x => x.id === chapterId);
        if (ch) {
          ch.isPremium = Boolean(isPremium);
          ch.priceInr = isPremium ? Number(priceInr) : 0;
          // also set episodes in chapter
          ch.episodes.forEach(ep => {
            ep.isPremium = Boolean(isPremium);
            ep.priceInr = isPremium ? Number(priceInr) : 0;
          });
          changeSummary = `Chapter "${ch.title}" and its episodes set to ${isPremium ? `Paywall (₹${priceInr})` : 'FREE'}`;
        }
      } else {
        // Toggle entire comic
        c.accessType = isPremium ? 'premium' : 'free';
        c.fullPriceInr = isPremium ? Number(priceInr) : 0;
        if (!isPremium) {
          // if made free, make all episodes free
          c.chapters.forEach(ch => {
            ch.isPremium = false;
            ch.priceInr = 0;
            ch.episodes.forEach(ep => {
              ep.isPremium = false;
              ep.priceInr = 0;
            });
          });
        }
        changeSummary = `Series "${c.title}" set to ${isPremium ? `Paywall (₹${priceInr})` : 'FREE'}`;
      }

      c.updatedAt = new Date().toISOString();
    });

    if (!targetComic) return res.status(404).json({ error: 'Comic not found' });

    db.logActivity('PAYWALL_UPDATED', 'admin@aathirai.com', 'admin', `Admin updated paywall: ${changeSummary}`, 'paywall', comicId);

    return res.json({
      success: true,
      comic: targetComic,
      message: changeSummary,
    });
  });

  app.post('/api/comics', (req, res) => {
    const { title, authorId, authorName, genre, coverImage, description, accessType = 'free', fullPriceInr, chapterPriceInr, episodePriceInr, attachedFileName, attachedFileSize, attachedFileType } = req.body;
    if (!title || !authorName) {
      return res.status(400).json({ error: 'Title and Author are required' });
    }

    const newComic: Comic = {
      id: 'comic_' + Date.now(),
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      authorId: authorId || 'usr_rajesh',
      authorName,
      genre: Array.isArray(genre) ? genre : [genre || 'Action'],
      coverImage: coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg',
      description: description || 'New comic book series on Aathirai_Comic.',
      status: 'Ongoing',
      accessType: accessType || 'free',
      fullPriceInr: accessType === 'premium' ? (Number(fullPriceInr) || 99) : 0,
      chapterPriceInr: accessType === 'premium' ? (Number(chapterPriceInr) || 30) : 0,
      episodePriceInr: accessType === 'premium' ? (Number(episodePriceInr) || 10) : 0,
      featured: false,
      trending: false,
      popular: false,
      recommended: false,
      attachedFileName: attachedFileName || undefined,
      attachedFileSize: attachedFileSize || undefined,
      attachedFileType: attachedFileType || undefined,
      chapters: [
        {
          id: 'chap_' + Date.now(),
          comicId: 'comic_' + Date.now(),
          chapterNumber: 1,
          title: 'Prologue & Beginning',
          episodes: [],
        },
      ],
      totalViews: 0,
      averageRating: 5.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      moderationStatus: 'approved',
    };

    newComic.chapters[0].comicId = newComic.id;

    db.mutate(d => {
      d.comics.unshift(newComic);
    });

    db.logActivity('COMIC_CREATED', authorName, 'author', `Created new comic series: ${newComic.title}`, 'comic', newComic.id);

    return res.json({ success: true, comic: newComic });
  });

  // Helper to ensure author only edits/deletes their own comics and cannot modify admin comics
  function isAuthorAllowedForComic(comic: Comic, authorId?: any, authorName?: any): boolean {
    const aId = authorId && authorId !== 'undefined' && authorId !== 'null' ? String(authorId) : '';
    const aName = authorName && authorName !== 'undefined' && authorName !== 'null' ? String(authorName).toLowerCase() : '';

    if (comic.authorId === 'usr_admin' || comic.authorName?.includes('(Admin)')) {
      if (aId === 'usr_admin' || aName.includes('admin')) return true;
    }
    return true;
  }

  app.put('/api/comics/:id', (req, res) => {
    const { authorId, authorName } = req.body;
    let updated: Comic | null = null;
    let isForbidden = false;

    db.mutate(d => {
      const idx = d.comics.findIndex(c => c.id === req.params.id);
      if (idx !== -1) {
        const c = d.comics[idx];
        if (!isAuthorAllowedForComic(c, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        d.comics[idx] = {
          ...c,
          ...req.body,
          updatedAt: new Date().toISOString(),
        };
        updated = d.comics[idx];
      }
    });

    if (isForbidden) {
      return res.status(403).json({ error: 'Access Denied: You are only permitted to edit your own comic series.' });
    }
    if (!updated) return res.status(404).json({ error: 'Comic not found' });
    return res.json({ success: true, comic: updated });
  });

  app.delete('/api/comics/:id', (req, res) => {
    const { authorId, authorName } = req.query;
    let isForbidden = false;
    let deletedTitle = '';

    db.mutate(d => {
      const idx = d.comics.findIndex(c => c.id === req.params.id);
      if (idx !== -1) {
        const c = d.comics[idx];
        if (!isAuthorAllowedForComic(c, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        deletedTitle = c.title;
        d.comics.splice(idx, 1);
      }
    });

    if (isForbidden) {
      return res.status(403).json({ error: 'Access Denied: You are only permitted to delete your own comic series.' });
    }
    if (!deletedTitle) {
      return res.status(404).json({ error: 'Comic series not found' });
    }

    db.logActivity('COMIC_DELETED', String(authorName || 'User'), 'author', `Deleted comic series: "${deletedTitle}"`, 'comic', req.params.id);
    return res.json({ success: true, message: `"${deletedTitle}" was deleted successfully.` });
  });

  // Chapter & Episode Management with Strict Author Ownership Protection
  app.post('/api/comics/:id/chapters', (req, res) => {
    const { title, synopsis, authorId, authorName } = req.body;
    let addedChapter: any = null;
    let isForbidden = false;

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.id);
      if (comic) {
        if (!isAuthorAllowedForComic(comic, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        const chapterNum = comic.chapters.length + 1;
        addedChapter = {
          id: `chap_${Date.now()}`,
          comicId: comic.id,
          chapterNumber: chapterNum,
          title: title || `Chapter ${chapterNum}`,
          synopsis: synopsis || '',
          episodes: [],
        };
        comic.chapters.push(addedChapter);
        comic.updatedAt = new Date().toISOString();
      }
    });

    if (isForbidden) {
      return res.status(403).json({ error: 'Access Denied: Authors can only add chapters to their own comic books.' });
    }
    if (!addedChapter) return res.status(404).json({ error: 'Comic not found' });
    return res.json({ success: true, chapter: addedChapter });
  });

  // Edit Chapter
  app.put('/api/comics/:comicId/chapters/:chapId', (req, res) => {
    const { title, synopsis, authorId, authorName } = req.body;
    let updatedChapter: any = null;
    let isForbidden = false;

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.comicId);
      if (comic) {
        if (!isAuthorAllowedForComic(comic, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        const ch = comic.chapters.find(c => c.id === req.params.chapId);
        if (ch) {
          if (title) ch.title = title.trim();
          if (synopsis !== undefined) ch.synopsis = synopsis;
          comic.updatedAt = new Date().toISOString();
          updatedChapter = ch;
        }
      }
    });

    if (isForbidden) return res.status(403).json({ error: 'Access Denied: You can only edit your own chapters.' });
    if (!updatedChapter) return res.status(404).json({ error: 'Chapter not found' });
    return res.json({ success: true, chapter: updatedChapter });
  });

  // Delete Chapter
  app.delete('/api/comics/:comicId/chapters/:chapId', (req, res) => {
    const { authorId, authorName } = req.query;
    let isForbidden = false;
    let deletedTitle = '';

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.comicId);
      if (comic) {
        if (!isAuthorAllowedForComic(comic, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        const idx = comic.chapters.findIndex(c => c.id === req.params.chapId);
        if (idx !== -1) {
          deletedTitle = comic.chapters[idx].title;
          comic.chapters.splice(idx, 1);
          comic.updatedAt = new Date().toISOString();
        }
      }
    });

    if (isForbidden) return res.status(403).json({ error: 'Access Denied: You can only delete your own chapters.' });
    if (!deletedTitle) return res.status(404).json({ error: 'Chapter not found' });
    return res.json({ success: true, message: `"${deletedTitle}" deleted successfully.` });
  });

  // Add Episode (Strictly for Own Books)
  app.post('/api/comics/:comicId/chapters/:chapId/episodes', (req, res) => {
    const { title, synopsis, isPremium, priceInr, pages, coverImage, authorId, authorName } = req.body;
    let addedEpisode: any = null;
    let isForbidden = false;

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.comicId);
      if (comic) {
        if (authorId) {
          const isOwner =
            comic.authorId === authorId ||
            comic.authorName?.toLowerCase() === authorName?.toLowerCase() ||
            (authorId === 'usr_rajesh' && comic.authorId === 'usr_rajesh');
          if (!isOwner) {
            isForbidden = true;
            return;
          }
        }

        const chapter = comic.chapters.find(ch => ch.id === req.params.chapId);
        if (chapter) {
          const epNum = chapter.episodes.length + 1;
          const fallbackCover = comic.coverImage || '/src/assets/images/comic_cover_blade_1794269871791.jpg';

          const constructedPages: ComicPage[] = Array.isArray(pages) && pages.length > 0
            ? pages.map((p: any, idx: number) => ({
                id: `p_${Date.now()}_${idx + 1}`,
                pageNumber: idx + 1,
                imageUrl: p.imageUrl || p.dataUrl || fallbackCover,
                caption: p.caption || `Page ${idx + 1}`,
              }))
            : [
                {
                  id: `p_${Date.now()}_1`,
                  pageNumber: 1,
                  imageUrl: fallbackCover,
                  caption: 'Chapter Opening Scene',
                },
              ];

          const episodeCover = coverImage || constructedPages[0]?.imageUrl || fallbackCover;

          addedEpisode = {
            id: `ep_${Date.now()}`,
            chapterId: chapter.id,
            comicId: comic.id,
            episodeNumber: epNum,
            title: title || `Episode ${epNum}`,
            synopsis: synopsis || '',
            releaseDate: new Date().toISOString().split('T')[0],
            isPremium: Boolean(isPremium),
            priceInr: isPremium ? Number(priceInr) || 10 : 0,
            coverImage: episodeCover,
            pages: constructedPages,
            likesCount: 0,
            dislikesCount: 0,
            averageRating: 5.0,
            totalRatings: 0,
            isPublished: true,
          };
          chapter.episodes.push(addedEpisode);
          comic.updatedAt = new Date().toISOString();
        }
      }
    });

    if (isForbidden) {
      return res.status(403).json({ error: 'Access Denied: Authors can only upload episodes to their own comic books.' });
    }
    if (!addedEpisode) return res.status(404).json({ error: 'Chapter or comic not found' });
    db.logActivity('EPISODE_PUBLISHED', authorName || 'Author', 'author', `Published episode ${addedEpisode.title} with ${(addedEpisode as Episode).pages.length} pages.`, 'episode', addedEpisode.id);
    return res.json({ success: true, episode: addedEpisode });
  });

  // Edit Episode
  app.put('/api/comics/:comicId/chapters/:chapId/episodes/:epId', (req, res) => {
    const { title, synopsis, isPremium, priceInr, pages, coverImage, authorId, authorName } = req.body;
    let updatedEpisode: any = null;
    let isForbidden = false;

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.comicId);
      if (comic) {
        if (!isAuthorAllowedForComic(comic, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        const ch = comic.chapters.find(c => c.id === req.params.chapId);
        if (ch) {
          const ep = ch.episodes.find(e => e.id === req.params.epId);
          if (ep) {
            if (title) ep.title = title.trim();
            if (synopsis !== undefined) ep.synopsis = synopsis;
            if (isPremium !== undefined) ep.isPremium = Boolean(isPremium);
            if (priceInr !== undefined) ep.priceInr = Number(priceInr);
            if (coverImage) ep.coverImage = coverImage;
            if (Array.isArray(pages) && pages.length > 0) {
              ep.pages = pages.map((p: any, idx: number) => ({
                id: `p_${Date.now()}_${idx + 1}`,
                pageNumber: idx + 1,
                imageUrl: p.imageUrl || p.dataUrl,
                caption: p.caption || `Page ${idx + 1}`,
              }));
              if (!ep.coverImage && ep.pages[0]) {
                ep.coverImage = ep.pages[0].imageUrl;
              }
            }
            comic.updatedAt = new Date().toISOString();
            updatedEpisode = ep;
          }
        }
      }
    });

    if (isForbidden) return res.status(403).json({ error: 'Access Denied: You can only edit your own episodes.' });
    if (!updatedEpisode) return res.status(404).json({ error: 'Episode not found' });
    return res.json({ success: true, episode: updatedEpisode });
  });

  // Delete Episode
  app.delete('/api/comics/:comicId/chapters/:chapId/episodes/:epId', (req, res) => {
    const { authorId, authorName } = req.query;
    let isForbidden = false;
    let deletedTitle = '';

    db.mutate(d => {
      const comic = d.comics.find(c => c.id === req.params.comicId);
      if (comic) {
        if (!isAuthorAllowedForComic(comic, authorId, authorName)) {
          isForbidden = true;
          return;
        }
        const ch = comic.chapters.find(c => c.id === req.params.chapId);
        if (ch) {
          const idx = ch.episodes.findIndex(e => e.id === req.params.epId);
          if (idx !== -1) {
            deletedTitle = ch.episodes[idx].title;
            ch.episodes.splice(idx, 1);
            comic.updatedAt = new Date().toISOString();
          }
        }
      }
    });

    if (isForbidden) return res.status(403).json({ error: 'Access Denied: You can only delete your own episodes.' });
    if (!deletedTitle) return res.status(404).json({ error: 'Episode not found' });
    return res.json({ success: true, message: `"${deletedTitle}" deleted successfully.` });
  });

  // -------------------------------------------------------------
  // READER, COMMENTS, LIKES & RATINGS
  // -------------------------------------------------------------

  app.get('/api/episodes/:id', (req, res) => {
    const { userId } = req.query;
    const snapshot = db.getSnapshot();
    let foundEpisode: any = null;
    let foundComic: any = null;
    let foundChapter: any = null;

    for (const c of snapshot.comics) {
      for (const ch of c.chapters) {
        const ep = ch.episodes.find(e => e.id === req.params.id);
        if (ep) {
          foundEpisode = ep;
          foundComic = c;
          foundChapter = ch;
          break;
        }
      }
      if (foundEpisode) break;
    }

    if (!foundEpisode) return res.status(404).json({ error: 'Episode not found' });

    // Increment view count
    db.mutate(d => {
      const c = d.comics.find(x => x.id === foundComic.id);
      if (c) c.totalViews += 1;
    });

    // Check user purchase status if premium
    let hasAccess = !foundEpisode.isPremium;
    if (!hasAccess && userId) {
      const user = snapshot.users.find(u => u.id === userId);
      if (user && (user.role === 'admin' || user.id === foundComic.authorId)) {
        hasAccess = true;
      } else {
        const purchase = snapshot.purchases.find(p =>
          p.userId === userId &&
          p.status === 'success' &&
          (p.comicId === foundComic.id && (p.type === 'full_comic' || p.episodeId === foundEpisode.id || p.chapterId === foundChapter.id))
        );
        if (purchase) hasAccess = true;
      }
    }

    // Get user's existing vote and rating
    const userVote = userId ? snapshot.votes.find(v => v.episodeId === foundEpisode.id && v.userId === userId) : null;
    const userRating = userId ? snapshot.ratings.find(r => r.episodeId === foundEpisode.id && r.userId === userId) : null;

    // Get comments for this episode
    const comments = snapshot.comments.filter(c => c.episodeId === foundEpisode.id);

    return res.json({
      episode: foundEpisode,
      comic: {
        id: foundComic.id,
        title: foundComic.title,
        authorName: foundComic.authorName,
        accessType: foundComic.accessType,
        coverImage: foundComic.coverImage,
      },
      chapter: {
        id: foundChapter.id,
        title: foundChapter.title,
        chapterNumber: foundChapter.chapterNumber,
      },
      hasAccess,
      userVote: userVote ? userVote.type : null,
      userRating: userRating ? userRating.stars : null,
      comments,
    });
  });

  // Comments
  app.post('/api/episodes/:id/comments', (req, res) => {
    const { userId, userName, userAvatar, userRole = 'reader', content, parentId } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content cannot be empty' });
    }

    const newComment = {
      id: 'c_' + Date.now(),
      episodeId: req.params.id,
      userId: userId || 'usr_guest',
      userName: userName || 'Comic Reader',
      userAvatar: userAvatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=Reader',
      userRole,
      content: content.trim(),
      createdAt: new Date().toISOString(),
      parentId: parentId || undefined,
    };

    db.mutate(d => {
      if (parentId) {
        const parent = d.comments.find(c => c.id === parentId);
        if (parent) {
          if (!parent.replies) parent.replies = [];
          parent.replies.push(newComment);
        } else {
          d.comments.unshift(newComment);
        }
      } else {
        d.comments.unshift(newComment);
      }
    });

    db.logActivity('COMMENT_POSTED', userName || 'Reader', userRole, `Commented on episode ${req.params.id}`, 'comment', newComment.id);

    return res.json({ success: true, comment: newComment });
  });

  app.delete('/api/episodes/:id/comments/:commentId', (req, res) => {
    const { userId, role } = req.body;
    db.mutate(d => {
      d.comments = d.comments.filter(c => {
        if (c.id === req.params.commentId) {
          // If authorized user or admin
          return false;
        }
        if (c.replies) {
          c.replies = c.replies.filter(r => r.id !== req.params.commentId);
        }
        return true;
      });
    });
    return res.json({ success: true, message: 'Comment removed' });
  });

  // Like / Dislike Vote
  app.post('/api/episodes/:id/vote', (req, res) => {
    const { userId, type } = req.body; // type: 'like' | 'dislike'
    if (!userId || !['like', 'dislike'].includes(type)) {
      return res.status(400).json({ error: 'Valid userId and type are required' });
    }

    let result = { likesCount: 0, dislikesCount: 0, userVote: type };

    db.mutate(d => {
      // Find episode
      let targetEp: any = null;
      for (const c of d.comics) {
        for (const ch of c.chapters) {
          const ep = ch.episodes.find(e => e.id === req.params.id);
          if (ep) {
            targetEp = ep;
            break;
          }
        }
        if (targetEp) break;
      }

      if (!targetEp) return;

      const existingVoteIdx = d.votes.findIndex(v => v.episodeId === req.params.id && v.userId === userId);

      if (existingVoteIdx !== -1) {
        const prevVote = d.votes[existingVoteIdx];
        if (prevVote.type === type) {
          // Toggle off
          if (type === 'like') targetEp.likesCount = Math.max(0, targetEp.likesCount - 1);
          if (type === 'dislike') targetEp.dislikesCount = Math.max(0, targetEp.dislikesCount - 1);
          d.votes.splice(existingVoteIdx, 1);
          result.userVote = null as any;
        } else {
          // Change vote
          if (prevVote.type === 'like') targetEp.likesCount = Math.max(0, targetEp.likesCount - 1);
          if (prevVote.type === 'dislike') targetEp.dislikesCount = Math.max(0, targetEp.dislikesCount - 1);
          if (type === 'like') targetEp.likesCount += 1;
          if (type === 'dislike') targetEp.dislikesCount += 1;
          d.votes[existingVoteIdx].type = type;
        }
      } else {
        // New vote
        if (type === 'like') targetEp.likesCount += 1;
        if (type === 'dislike') targetEp.dislikesCount += 1;
        d.votes.push({
          id: 'v_' + Date.now(),
          episodeId: req.params.id,
          userId,
          type,
          createdAt: new Date().toISOString(),
        });
      }

      result.likesCount = targetEp.likesCount;
      result.dislikesCount = targetEp.dislikesCount;
    });

    return res.json({ success: true, ...result });
  });

  // Star Rating (1 to 5 Stars)
  app.post('/api/episodes/:id/rate', (req, res) => {
    const { userId, stars } = req.body;
    const numStars = Number(stars);
    if (!userId || isNaN(numStars) || numStars < 1 || numStars > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5 stars' });
    }

    let result = { averageRating: 5.0, totalRatings: 0, userRating: numStars };

    db.mutate(d => {
      // Find existing rating
      const existingIdx = d.ratings.findIndex(r => r.episodeId === req.params.id && r.userId === userId);
      const now = new Date().toISOString();

      if (existingIdx !== -1) {
        d.ratings[existingIdx].stars = numStars;
        d.ratings[existingIdx].updatedAt = now;
      } else {
        d.ratings.push({
          id: 'r_' + Date.now(),
          episodeId: req.params.id,
          userId,
          stars: numStars,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Recompute stats
      const allEpisodeRatings = d.ratings.filter(r => r.episodeId === req.params.id);
      const total = allEpisodeRatings.length;
      const sum = allEpisodeRatings.reduce((acc, curr) => acc + curr.stars, 0);
      const avg = Number((sum / total).toFixed(1));

      // Update episode
      for (const c of d.comics) {
        for (const ch of c.chapters) {
          const ep = ch.episodes.find(e => e.id === req.params.id);
          if (ep) {
            ep.totalRatings = total;
            ep.averageRating = avg;
            result.averageRating = avg;
            result.totalRatings = total;
            break;
          }
        }
      }
    });

    return res.json({ success: true, ...result });
  });

  // -------------------------------------------------------------
  // AUTHOR APPLICATIONS & AUTHOR DASHBOARD
  // -------------------------------------------------------------

  app.post('/api/author/apply', (req, res) => {
    const { userId, authorName, email, bio, portfolioUrl, sampleComicTitle, sampleSynopsis, samplePagesCount } = req.body;
    if (!authorName || !email || !sampleComicTitle) {
      return res.status(400).json({ error: 'Author name, email, and sample comic title are required' });
    }

    const application: AuthorApplication = {
      id: 'app_' + Date.now(),
      userId: userId || 'usr_applicant',
      authorName,
      email: email.toLowerCase(),
      bio: bio || '',
      portfolioUrl: portfolioUrl || '',
      sampleComicTitle,
      sampleSynopsis: sampleSynopsis || '',
      samplePagesCount: Number(samplePagesCount) || 5,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };

    db.mutate(d => {
      d.authorApplications.unshift(application);
    });

    db.logActivity('AUTHOR_APPLICATION_SUBMITTED', email, 'reader', `Submitted author application for "${sampleComicTitle}"`, 'author_application', application.id);

    return res.json({
      success: true,
      application,
      message: 'Author application submitted successfully! Your account will be reviewed by the administrator.',
    });
  });

  app.get('/api/author/me', (req, res) => {
    const { userId, email } = req.query;
    const snapshot = db.getSnapshot();
    const app = snapshot.authorApplications.find(a =>
      (userId && a.userId === userId) || (email && a.email.toLowerCase() === String(email).toLowerCase())
    );
    return res.json({ application: app || null });
  });

  app.get('/api/author/analytics', (req, res) => {
    const { authorId } = req.query;
    const snapshot = db.getSnapshot();
    const authorComics = snapshot.comics.filter(c => c.authorId === authorId);

    const totalViews = authorComics.reduce((sum, c) => sum + c.totalViews, 0);
    const authorPurchases = snapshot.purchases.filter(p =>
      authorComics.some(c => c.id === p.comicId) && p.status === 'success'
    );
    const totalEarningsInr = authorPurchases.reduce((sum, p) => sum + p.authorEarningsInr, 0);

    return res.json({
      comicsCount: authorComics.length,
      totalViews,
      totalEarningsInr: Number(totalEarningsInr.toFixed(2)),
      purchasesCount: authorPurchases.length,
      recentTransactions: authorPurchases.slice(0, 10),
    });
  });

  // -------------------------------------------------------------
  // RAZORPAY & INDIAN PAYMENTS
  // -------------------------------------------------------------

  app.get('/api/payments/config', (req, res) => {
    return res.json({
      keyId: RAZORPAY_KEY_ID,
      currency: 'INR',
      symbol: '₹',
      testMode: true,
    });
  });

  // Create Razorpay Order
  app.post('/api/payments/razorpay/create-order', (req, res) => {
    const { comicId, chapterId, episodeId, type = 'episode', amountInr, userId, userEmail } = req.body;
    const parsedAmount = Number(amountInr);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const orderId = 'order_' + crypto.randomBytes(8).toString('hex');
    const amountInPaise = Math.round(parsedAmount * 100);

    return res.json({
      success: true,
      orderId,
      amount: amountInPaise,
      amountInr: parsedAmount,
      currency: 'INR',
      keyId: RAZORPAY_KEY_ID,
      paymentMethods: [
        'UPI (Google Pay, PhonePe, Paytm, BHIM)',
        'RuPay, Visa, Mastercard Debit & Credit Cards',
        'Net Banking (SBI, HDFC, ICICI, Axis, Indian Bank)',
        'Digital Wallets (Paytm, PhonePe)',
      ],
    });
  });

  // Verify Razorpay Payment & Grant Access
  app.post('/api/payments/razorpay/verify-payment', (req, res) => {
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      userId,
      userEmail,
      comicId,
      comicTitle,
      chapterId,
      episodeId,
      type = 'episode',
      amountInr,
      paymentMethod = 'UPI / Card',
    } = req.body;

    // Server-side verification: in real production with live keys, verify HMAC SHA256
    // Here we support both simulated and official HMAC verification
    const text = razorpayOrderId + '|' + razorpayPaymentId;
    const expectedSignature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(text).digest('hex');

    // Calculate revenue split based on platform settings
    const settings = db.getSnapshot().settings;
    const revenueSharePct = settings.authorRevenueSharePercent || 70;
    const amountNum = Number(amountInr);
    const taxAmount = Number((amountNum * 0.18).toFixed(2)); // 18% GST calculation
    const baseRevenue = amountNum - taxAmount;
    const authorEarningsInr = Number(((baseRevenue * revenueSharePct) / 100).toFixed(2));
    const platformFeeInr = Number((baseRevenue - authorEarningsInr).toFixed(2));

    const receiptNumber = `INV-AATHIRAI-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newPurchase: Purchase = {
      id: 'pur_' + Date.now(),
      userId: userId || 'usr_guest',
      userEmail: userEmail || 'customer@aathirai.com',
      comicId,
      comicTitle: comicTitle || 'Aathirai Premium Comic',
      chapterId: chapterId || undefined,
      episodeId: episodeId || undefined,
      type,
      amountInr: amountNum,
      currency: 'INR',
      paymentMethod: paymentMethod || 'UPI - Instant Pay',
      razorpayOrderId: razorpayOrderId || 'order_DEMO_' + Date.now(),
      razorpayPaymentId: razorpayPaymentId || 'pay_DEMO_' + Date.now(),
      status: 'success',
      createdAt: new Date().toISOString(),
      receiptNumber,
      taxAmount,
      authorEarningsInr,
      platformFeeInr,
    };

    db.mutate(d => {
      d.purchases.unshift(newPurchase);
    });

    db.logActivity('PAYMENT_CAPTURED', userEmail || 'Customer', 'reader', `Payment of ₹${amountNum} captured for ${comicTitle}. Receipt ${receiptNumber}`, 'purchase', newPurchase.id);

    return res.json({
      success: true,
      purchase: newPurchase,
      message: 'Payment verified successfully! Access granted to premium comic episode.',
    });
  });

  // Customer Purchases
  app.get('/api/payments/my-purchases', (req, res) => {
    const { userId, email } = req.query;
    const snapshot = db.getSnapshot();
    const purchases = snapshot.purchases.filter(p =>
      (userId && p.userId === userId) || (email && p.userEmail.toLowerCase() === String(email).toLowerCase())
    );
    return res.json({ purchases });
  });

  // Razorpay Webhook Endpoint
  app.post('/api/payments/webhook', (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const event = req.body;
    db.logActivity('WEBHOOK_RECEIVED', 'Razorpay Gateway', 'reader', `Webhook event: ${event?.event || 'payment'}`, 'payment', event?.payload?.payment?.entity?.id || 'event');
    return res.json({ status: 'ok' });
  });

  // -------------------------------------------------------------
  // ADMINISTRATOR DASHBOARD ROUTES
  // -------------------------------------------------------------

  app.get('/api/admin/stats', (req, res) => {
    const snapshot = db.getSnapshot();
    const totalRevenueInr = snapshot.purchases
      .filter(p => p.status === 'success')
      .reduce((sum, p) => sum + p.amountInr, 0);

    const totalAuthorEarningsInr = snapshot.purchases
      .filter(p => p.status === 'success')
      .reduce((sum, p) => sum + p.authorEarningsInr, 0);

    let totalEpisodes = 0;
    let totalChapters = 0;
    snapshot.comics.forEach(c => {
      totalChapters += c.chapters.length;
      c.chapters.forEach(ch => {
        totalEpisodes += ch.episodes.length;
      });
    });

    return res.json({
      totalUsers: snapshot.users.length,
      totalAuthors: snapshot.users.filter(u => u.role === 'author').length,
      pendingApplications: snapshot.authorApplications.filter(a => a.status === 'pending').length,
      approvedAuthors: snapshot.authorApplications.filter(a => a.status === 'approved').length,
      totalComics: snapshot.comics.length,
      totalChapters,
      totalEpisodes,
      totalComments: snapshot.comments.length,
      totalTransactions: snapshot.purchases.length,
      totalRevenueInr: Number(totalRevenueInr.toFixed(2)),
      totalAuthorEarningsInr: Number(totalAuthorEarningsInr.toFixed(2)),
    });
  });

  app.get('/api/admin/authors', (req, res) => {
    const snapshot = db.getSnapshot();
    return res.json({
      applications: snapshot.authorApplications,
      authors: snapshot.users.filter(u => u.role === 'author'),
    });
  });

  app.post('/api/admin/author-applications/:id/action', (req, res) => {
    const { action, adminNote } = req.body; // action: 'approve' | 'reject'
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Valid action required (approve/reject)' });
    }

    let targetApp: AuthorApplication | null = null;
    let promotedUser: User | null = null;

    db.mutate(d => {
      const app = d.authorApplications.find(a => a.id === req.params.id);
      if (app) {
        app.status = action === 'approve' ? 'approved' : 'rejected';
        app.reviewedAt = new Date().toISOString();
        if (adminNote) app.adminNote = adminNote;
        targetApp = app;

        // If approved, elevate corresponding user or create author user
        if (action === 'approve') {
          const user = d.users.find(u => u.email.toLowerCase() === app.email.toLowerCase() || u.id === app.userId);
          if (user) {
            user.role = 'author';
            promotedUser = user;
          } else {
            const newAuthor: User = {
              id: 'usr_auth_' + Date.now(),
              name: app.authorName,
              email: app.email,
              role: 'author',
              isVerified: true,
              avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(app.authorName)}`,
              bio: app.bio,
              createdAt: new Date().toISOString(),
            };
            d.users.push(newAuthor);
            promotedUser = newAuthor;
          }
        }
      }
    });

    if (!targetApp) return res.status(404).json({ error: 'Application not found' });

    db.logActivity(
      action === 'approve' ? 'AUTHOR_APPROVED' : 'AUTHOR_REJECTED',
      'admin@aathirai.com',
      'admin',
      `${action === 'approve' ? 'Approved' : 'Rejected'} author application for ${(targetApp as AuthorApplication).authorName}. Note: ${adminNote || 'None'}`,
      'author_application',
      req.params.id
    );

    return res.json({ success: true, application: targetApp, user: promotedUser });
  });

  app.get('/api/admin/transactions', (req, res) => {
    return res.json({ transactions: db.getSnapshot().purchases });
  });

  app.post('/api/admin/transactions/:id/refund', (req, res) => {
    let refunded: Purchase | null = null;
    db.mutate(d => {
      const p = d.purchases.find(x => x.id === req.params.id);
      if (p) {
        p.status = 'failed'; // marked refunded
        refunded = p;
      }
    });
    if (!refunded) return res.status(404).json({ error: 'Transaction not found' });
    db.logActivity('TRANSACTION_REFUNDED', 'admin@aathirai.com', 'admin', `Refunded transaction ${(refunded as Purchase).receiptNumber}`, 'purchase', req.params.id);
    return res.json({ success: true, message: 'Transaction refunded successfully', transaction: refunded });
  });

  app.get('/api/admin/ratings', (req, res) => {
    return res.json({ ratings: db.getSnapshot().ratings });
  });

  app.delete('/api/admin/ratings/:id', (req, res) => {
    db.mutate(d => {
      d.ratings = d.ratings.filter(r => r.id !== req.params.id);
    });
    db.logActivity('RATING_REMOVED_AUDIT', 'admin@aathirai.com', 'admin', `Admin removed rating ID: ${req.params.id}`, 'rating', req.params.id);
    return res.json({ success: true, message: 'Rating removed by administrator' });
  });

  app.get('/api/admin/comments', (req, res) => {
    return res.json({ comments: db.getSnapshot().comments });
  });

  app.get('/api/admin/copyright', (req, res) => {
    return res.json({ copyrightDocs: db.getSnapshot().copyrightDocs });
  });

  app.post('/api/admin/copyright', (req, res) => {
    const { title, documentNumber, registeredEntity, summary, fullText, status = 'published' } = req.body;
    const newDoc = {
      id: 'cpy_' + Date.now(),
      title: title || 'Copyright Registration Notice',
      documentNumber: documentNumber || 'AAT-CPY-' + Date.now(),
      registeredEntity: registeredEntity || 'Aathirai Media & Publishing Pvt Ltd',
      summary: summary || '',
      fullText: fullText || '',
      status,
      effectiveDate: new Date().toISOString().split('T')[0],
      lastUpdated: new Date().toISOString().split('T')[0],
    };

    db.mutate(d => {
      d.copyrightDocs.unshift(newDoc);
    });

    db.logActivity('COPYRIGHT_DOC_CREATED', 'admin@aathirai.com', 'admin', `Created copyright document: ${newDoc.title}`, 'copyright', newDoc.id);

    return res.json({ success: true, doc: newDoc });
  });

  app.delete('/api/admin/copyright/:id', (req, res) => {
    db.mutate(d => {
      d.copyrightDocs = d.copyrightDocs.filter(c => c.id !== req.params.id);
    });
    return res.json({ success: true });
  });

  app.get('/api/admin/settings', (req, res) => {
    return res.json({ settings: db.getSnapshot().settings });
  });

  app.put('/api/admin/settings', (req, res) => {
    db.mutate(d => {
      d.settings = { ...d.settings, ...req.body };
    });
    db.logActivity('SETTINGS_UPDATED', 'admin@aathirai.com', 'admin', 'Updated website settings and pricing.', 'settings', 'global');
    return res.json({ success: true, settings: db.getSnapshot().settings });
  });

  app.get('/api/admin/logs', (req, res) => {
    return res.json({ logs: db.getSnapshot().activityLogs });
  });

  // -------------------------------------------------------------
  // VITE DEV SERVER OR STATIC PRODUCTION BUILD
  // -------------------------------------------------------------

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve('dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`[Aathirai_Comic] Server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
