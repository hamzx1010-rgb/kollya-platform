/**
 * KOLIYA — i18n_sm.js
 * ============================================================
 * English · Français · العربية — English is the default.
 *
 * The Arabic here is written, not machine-translated. A literal
 * rendering of French UI copy reads like a form letter to an
 * Algerian student; where the natural phrasing differs from the
 * French, the natural phrasing wins.
 *
 * HOW IT WORKS
 *   t('nav.home')                     -> "Home"
 *   t('dm.unread', { n: 3 })          -> "3 unread"
 *   <span data-i18n="nav.home"></span> is filled by applyI18n()
 *
 * A missing key returns the key itself rather than blank, so a gap
 * is obvious in the UI instead of silently invisible.
 * ============================================================
 */

import { prefs, emit } from './store_sm.js';

export const LANGS = [
  { id: 'en', label: 'English',  native: 'English',  dir: 'ltr', flag: 'EN' },
  { id: 'fr', label: 'French',   native: 'Français', dir: 'ltr', flag: 'FR' },
  { id: 'ar', label: 'Arabic',   native: 'العربية',  dir: 'rtl', flag: 'ع' }
];

export const DEFAULT_LANG = 'en';

/* ============================================================
   STRINGS
   ============================================================ */

const STRINGS = {
  en: {
    'app.name': 'Koliya',
    'app.tagline': 'Your campus, in one place',

    'nav.home': 'Home', 'nav.explore': 'Explore', 'nav.messages': 'Messages',
    'nav.notifications': 'Notifications', 'nav.hub': 'Hub', 'nav.channels': 'Channels',
    'nav.events': 'Events', 'nav.qa': 'Q&A', 'nav.saved': 'Saved',
    'nav.leaderboard': 'Leaderboard', 'nav.profile': 'Profile', 'nav.settings': 'Settings',
    'nav.compose': 'Create',

    'action.save': 'Save', 'action.cancel': 'Cancel', 'action.delete': 'Delete',
    'action.confirm': 'Confirm', 'action.close': 'Close', 'action.retry': 'Try again',
    'action.send': 'Send', 'action.publish': 'Publish', 'action.create': 'Create',
    'action.edit': 'Edit', 'action.reply': 'Reply', 'action.share': 'Share',
    'action.report': 'Report', 'action.block': 'Block', 'action.follow': 'Follow',
    'action.unfollow': 'Unfollow', 'action.following': 'Following',
    'action.requested': 'Requested', 'action.message': 'Message', 'action.search': 'Search',
    'action.copy': 'Copy', 'action.copied': 'Copied', 'action.more': 'More',
    'action.back': 'Back', 'action.seeAll': 'See all', 'action.loadMore': 'Load more',

    'feed.forYou': 'For you', 'feed.following': 'Following', 'feed.faculty': 'My faculty',
    'feed.empty.title': 'Nothing here yet',
    'feed.empty.text': 'Be the first to post today.',
    'feed.placeholder': "What's happening on campus?",
    'feed.anonymous': 'Anonymous', 'feed.poll': 'Poll', 'feed.photo': 'Photo',
    'feed.post': 'Post', 'feed.comments': 'Comments', 'feed.comment.placeholder': 'Write a comment…',
    'feed.comment.none': 'No comments yet', 'feed.published': 'Posted',
    'feed.deleted': 'Post deleted', 'feed.saved': 'Saved', 'feed.unsaved': 'Removed from saved',
    'feed.voted': 'You already voted', 'feed.story.yours': 'Your story',

    'dm.title': 'Messages', 'dm.new': 'New message', 'dm.search': 'Search…',
    'dm.placeholder': 'Write a message…', 'dm.empty.title': 'No conversations',
    'dm.empty.text': 'Start talking with students from your faculty.',
    'dm.sayHi': 'Say hello', 'dm.online': 'Online', 'dm.offline': 'Last seen recently',
    'dm.typing': 'typing…', 'dm.edited': 'edited', 'dm.you': 'You: ',
    'dm.photo': 'Photo', 'dm.video': 'Video', 'dm.voice': 'Voice message', 'dm.file': 'File',
    'dm.folder.all': 'All', 'dm.folder.unread': 'Unread', 'dm.folder.pinned': 'Pinned',
    'dm.folder.study': 'Study', 'dm.folder.muted': 'Muted', 'dm.folder.archived': 'Archived',
    'dm.newBelow': 'New messages', 'dm.notSent': 'Message not sent',
    'dm.info': 'Info', 'dm.sharedMedia': 'Shared media', 'dm.files': 'Files',
    'dm.links': 'Links', 'dm.nickname': 'Nickname', 'dm.theme': 'Chat theme',
    'dm.export': 'Export conversation', 'dm.clear': 'Clear conversation',
    'dm.mute': 'Mute notifications', 'dm.unmute': 'Unmute notifications',
    'dm.forward': 'Forward', 'dm.noContacts': 'No students to write to yet',

    'profile.edit': 'Edit profile', 'profile.posts': 'posts',
    'profile.followers': 'followers', 'profile.following': 'following',
    'profile.streak': 'streak', 'profile.private': 'Private',
    'profile.privateTitle': 'This account is private',
    'profile.privateText': 'Follow {name} to see their posts.',
    'profile.name': 'Full name', 'profile.username': 'Username', 'profile.bio': 'Bio',
    'profile.faculty': 'Faculty', 'profile.pronouns': 'Pronouns', 'profile.links': 'Links',
    'profile.website': 'Website', 'profile.privacy': 'Privacy',
    'profile.privateAccount': 'Private account',
    'profile.privateHint': 'Only accepted followers see your posts and stories.',
    'profile.updated': 'Profile updated', 'profile.identity': 'Identity',
    'profile.about': 'About', 'profile.cover': 'Cover', 'profile.noPosts': 'No posts',
    'profile.nameWarn.title': 'Change your name again?',
    'profile.nameWarn.text': 'You changed your name less than 15 days ago. ' +
      'Your classmates may not recognise you. The counter resets in {days} days.',
    'profile.nameWarn.confirm': 'Change anyway',
    'profile.nameWarn.cancel': 'Keep my name',

    'hub.title': 'Hub', 'hub.level': 'Level', 'hub.xp': 'XP total',
    'hub.streakDays': 'day streak', 'hub.best': 'best',
    'hub.quests': "Today's challenges", 'hub.badges': 'Badges',
    'hub.leaderboard': 'Leaderboard', 'hub.myFaculty': 'My faculty',
    'hub.allCampus': 'All campus', 'hub.freezeReady': 'Freeze ready',
    'hub.freezeUsed': 'Freeze used',
    'hub.freezeHint': 'A missed day will be covered automatically this month',
    'hub.questDone': 'Challenge complete', 'hub.dayComplete': "Today's challenges complete",
    'hub.rank': '{rank} in your faculty', 'hub.outOfTop': 'Outside the top 50',
    'hub.rankReward': 'Featured in "Students to discover"',
    'quest.visit': 'Open Koliya', 'quest.post': 'Post once',
    'quest.comment': 'Comment on 3 posts', 'quest.like': 'Like 5 posts',
    'quest.answer': 'Answer a question', 'quest.story': 'Post a story',
    'streak.lost': 'Streak lost — {n} days reset. Finish today to start again.',
    'streak.frozen': 'Missed day covered by your monthly freeze. Your streak continues.',

    'events.title': 'Events', 'events.eyebrow': 'Campus',
    'events.sub': 'Study sessions, talks, outings — everything happening around you.',
    'events.upcoming': 'upcoming', 'events.yours': 'you are attending',
    'events.create': 'Create an\nevent', 'events.attend': "I'm attending",
    'events.attending': 'Attending', 'events.none': 'Nothing planned yet',
    'events.when': 'Date and time', 'events.where': 'Location', 'events.what': 'Description',
    'qa.title': 'Questions & Answers', 'qa.eyebrow': 'Help each other',
    'qa.sub': "Ask what you don't dare ask in the lecture hall. Anonymously if you prefer.",
    'qa.count': 'questions', 'qa.unanswered': 'unanswered',
    'qa.ask': 'Ask a\nquestion', 'qa.answer': 'Answer', 'qa.bestAnswer': 'Best answer',
    'qa.anonymous': 'Stay anonymous',
    'qa.anonymousHint': 'Your name never leaves the server',
    'qa.none': 'No questions yet — ask yours',
    'channels.title': 'Channels', 'channels.join': 'Join', 'channels.joined': 'Joined',
    'channels.members': 'members', 'channels.create': 'Create a channel',
    'explore.title': 'Explore', 'explore.trends': 'Trending',
    'explore.people': 'People', 'explore.discover': 'Students to discover',
    'saved.title': 'Saved', 'saved.none': 'Nothing saved',

    'notif.title': 'Notifications', 'notif.all': 'All', 'notif.mentions': 'Mentions',
    'notif.follows': 'Follows', 'notif.none': 'Nothing new',
    'notif.markAllRead': 'Mark all read', 'notif.accept': 'Accept', 'notif.decline': 'Decline',
    'notif.enable': 'Get notified of new messages?',
    'notif.enableBtn': 'Enable', 'notif.enabled': 'Notifications enabled',
    'notif.enabledBody': "You'll be told about new messages and followers.",
    'notif.blocked': 'Notifications blocked. Allow them in your browser settings ' +
      '(padlock in the address bar).',
    'notif.test': 'Send a test notification', 'notif.testTitle': 'Koliya — test',
    'notif.testBody': 'If you can see this, notifications work.',
    'notif.sent': 'Notification sent', 'notif.unsupported': 'Your browser does not support notifications',

    'settings.title': 'Settings', 'settings.language': 'Language',
    'settings.languageHint': 'Changes the whole interface immediately.',
    'settings.appearance': 'Appearance', 'settings.theme': 'Theme',
    'settings.light': 'Light', 'settings.dark': 'Dark', 'settings.system': 'System',
    'settings.notifications': 'Notifications',
    'settings.notifHint': 'Alerts for new messages and followers, while Koliya is open.',
    'settings.account': 'Account', 'settings.signOut': 'Sign out',
    'settings.status.granted': 'Enabled', 'settings.status.denied': 'Blocked by the browser',
    'settings.status.default': 'Not enabled yet',

    'error.generic': 'Something went wrong', 'error.network': 'Connection problem',
    'error.session': 'Session expired — please sign in again',
    'error.notFound': 'Not found', 'error.loading': 'Could not load',
    'error.saveFailed': 'Save failed', 'error.tooHeavy': 'File too large',

    'time.now': 'now', 'time.minute': '{n}m', 'time.hour': '{n}h',
    'time.day': '{n}d', 'time.week': '{n}w',
    'time.today': 'Today', 'time.yesterday': 'Yesterday'
  },

  fr: {
    'app.name': 'Koliya',
    'app.tagline': 'Votre campus, en un seul endroit',

    'nav.home': 'Accueil', 'nav.explore': 'Explorer', 'nav.messages': 'Messages',
    'nav.notifications': 'Notifications', 'nav.hub': 'Hub', 'nav.channels': 'Canaux',
    'nav.events': 'Événements', 'nav.qa': 'Questions', 'nav.saved': 'Enregistrés',
    'nav.leaderboard': 'Classement', 'nav.profile': 'Profil', 'nav.settings': 'Réglages',
    'nav.compose': 'Créer',

    'action.save': 'Enregistrer', 'action.cancel': 'Annuler', 'action.delete': 'Supprimer',
    'action.confirm': 'Confirmer', 'action.close': 'Fermer', 'action.retry': 'Réessayer',
    'action.send': 'Envoyer', 'action.publish': 'Publier', 'action.create': 'Créer',
    'action.edit': 'Modifier', 'action.reply': 'Répondre', 'action.share': 'Partager',
    'action.report': 'Signaler', 'action.block': 'Bloquer', 'action.follow': 'Suivre',
    'action.unfollow': 'Se désabonner', 'action.following': 'Abonné',
    'action.requested': 'Demande envoyée', 'action.message': 'Message', 'action.search': 'Rechercher',
    'action.copy': 'Copier', 'action.copied': 'Copié', 'action.more': 'Plus',
    'action.back': 'Retour', 'action.seeAll': 'Tout voir', 'action.loadMore': 'Charger plus',

    'feed.forYou': 'Pour vous', 'feed.following': 'Abonnements', 'feed.faculty': 'Ma faculté',
    'feed.empty.title': 'Rien à afficher',
    'feed.empty.text': "Soyez le premier à publier aujourd'hui.",
    'feed.placeholder': 'Quoi de neuf sur le campus ?',
    'feed.anonymous': 'Anonyme', 'feed.poll': 'Sondage', 'feed.photo': 'Photo',
    'feed.post': 'Publication', 'feed.comments': 'Commentaires',
    'feed.comment.placeholder': 'Écrire un commentaire…',
    'feed.comment.none': 'Aucun commentaire', 'feed.published': 'Publié',
    'feed.deleted': 'Publication supprimée', 'feed.saved': 'Enregistré',
    'feed.unsaved': 'Retiré des enregistrés', 'feed.voted': 'Vous avez déjà voté',
    'feed.story.yours': 'Votre story',

    'dm.title': 'Messages', 'dm.new': 'Nouveau message', 'dm.search': 'Rechercher…',
    'dm.placeholder': 'Écrivez un message…', 'dm.empty.title': 'Aucune conversation',
    'dm.empty.text': 'Commencez à discuter avec les étudiants de votre faculté.',
    'dm.sayHi': 'Dites bonjour', 'dm.online': 'En ligne', 'dm.offline': 'Vu récemment',
    'dm.typing': 'écrit…', 'dm.edited': 'modifié', 'dm.you': 'Vous : ',
    'dm.photo': 'Photo', 'dm.video': 'Vidéo', 'dm.voice': 'Message vocal', 'dm.file': 'Fichier',
    'dm.folder.all': 'Tous', 'dm.folder.unread': 'Non lus', 'dm.folder.pinned': 'Épinglés',
    'dm.folder.study': 'Études', 'dm.folder.muted': 'Muets', 'dm.folder.archived': 'Archivés',
    'dm.newBelow': 'Nouveaux messages', 'dm.notSent': 'Message non envoyé',
    'dm.info': 'Infos', 'dm.sharedMedia': 'Médias partagés', 'dm.files': 'Fichiers',
    'dm.links': 'Liens', 'dm.nickname': 'Surnom', 'dm.theme': 'Thème de la conversation',
    'dm.export': 'Exporter la conversation', 'dm.clear': 'Vider la conversation',
    'dm.mute': 'Couper les notifications', 'dm.unmute': 'Réactiver les notifications',
    'dm.forward': 'Transférer', 'dm.noContacts': 'Aucun étudiant à qui écrire',

    'profile.edit': 'Modifier le profil', 'profile.posts': 'publications',
    'profile.followers': 'abonnés', 'profile.following': 'abonnements',
    'profile.streak': 'série', 'profile.private': 'Privé',
    'profile.privateTitle': 'Ce compte est privé',
    'profile.privateText': 'Suivez {name} pour voir ses publications.',
    'profile.name': 'Nom complet', 'profile.username': "Nom d'utilisateur", 'profile.bio': 'Bio',
    'profile.faculty': 'Faculté', 'profile.pronouns': 'Pronoms', 'profile.links': 'Liens',
    'profile.website': 'Site web', 'profile.privacy': 'Confidentialité',
    'profile.privateAccount': 'Compte privé',
    'profile.privateHint': 'Seuls vos abonnés acceptés voient vos publications et vos stories.',
    'profile.updated': 'Profil mis à jour', 'profile.identity': 'Identité',
    'profile.about': 'À propos', 'profile.cover': 'Couverture', 'profile.noPosts': 'Aucune publication',
    'profile.nameWarn.title': 'Changer votre nom à nouveau ?',
    'profile.nameWarn.text': 'Vous avez changé de nom il y a moins de 15 jours. ' +
      'Vos camarades risquent de ne plus vous reconnaître. Le compteur se réinitialise dans {days} jours.',
    'profile.nameWarn.confirm': 'Changer quand même',
    'profile.nameWarn.cancel': 'Garder mon nom',

    'hub.title': 'Hub', 'hub.level': 'Niveau', 'hub.xp': 'XP au total',
    'hub.streakDays': "jours d'affilée", 'hub.best': 'record',
    'hub.quests': 'Défis du jour', 'hub.badges': 'Badges',
    'hub.leaderboard': 'Classement', 'hub.myFaculty': 'Ma faculté',
    'hub.allCampus': 'Tout le campus', 'hub.freezeReady': 'Gel prêt',
    'hub.freezeUsed': 'Gel utilisé',
    'hub.freezeHint': 'Une journée manquée sera rattrapée automatiquement ce mois-ci',
    'hub.questDone': 'Défi accompli', 'hub.dayComplete': 'Défis du jour accomplis',
    'hub.rank': '{rank} de votre faculté', 'hub.outOfTop': 'Hors du top 50',
    'hub.rankReward': 'Mis en avant dans « Étudiants à découvrir »',
    'quest.visit': 'Ouvrir Koliya', 'quest.post': 'Publier une fois',
    'quest.comment': 'Commenter 3 publications', 'quest.like': 'Aimer 5 publications',
    'quest.answer': 'Répondre à une question', 'quest.story': 'Publier une story',
    'streak.lost': 'Série perdue — {n} jours remis à zéro. Terminez les défis aujourd\'hui pour repartir.',
    'streak.frozen': 'Journée manquée rattrapée par votre gel mensuel. Votre série continue.',

    'events.title': 'Événements', 'events.eyebrow': 'Campus',
    'events.sub': 'Révisions, conférences, sorties — tout ce qui se passe autour de vous.',
    'events.upcoming': 'à venir', 'events.yours': 'vos inscriptions',
    'events.create': 'Créer un\névénement', 'events.attend': 'Je participe',
    'events.attending': 'Inscrit', 'events.none': "Rien de prévu pour l'instant",
    'events.when': 'Date et heure', 'events.where': 'Lieu', 'events.what': 'Description',
    'qa.title': 'Questions & Réponses', 'qa.eyebrow': 'Entraide',
    'qa.sub': "Demandez ce que vous n'osez pas demander en amphi. Anonymement si vous préférez.",
    'qa.count': 'questions', 'qa.unanswered': 'sans réponse',
    'qa.ask': 'Poser une\nquestion', 'qa.answer': 'Répondre', 'qa.bestAnswer': 'Meilleure réponse',
    'qa.anonymous': 'Rester anonyme',
    'qa.anonymousHint': 'Votre nom ne quittera jamais le serveur',
    'qa.none': 'Aucune question — posez la vôtre',
    'channels.title': 'Canaux', 'channels.join': 'Rejoindre', 'channels.joined': 'Rejoint',
    'channels.members': 'membres', 'channels.create': 'Créer un canal',
    'explore.title': 'Explorer', 'explore.trends': 'Tendances',
    'explore.people': 'Personnes', 'explore.discover': 'Étudiants à découvrir',
    'saved.title': 'Enregistrés', 'saved.none': "Rien d'enregistré",

    'notif.title': 'Notifications', 'notif.all': 'Tout', 'notif.mentions': 'Mentions',
    'notif.follows': 'Abonnements', 'notif.none': 'Rien de neuf',
    'notif.markAllRead': 'Tout marquer lu', 'notif.accept': 'Accepter', 'notif.decline': 'Refuser',
    'notif.enable': 'Être prévenu des nouveaux messages ?',
    'notif.enableBtn': 'Activer', 'notif.enabled': 'Notifications activées',
    'notif.enabledBody': 'Vous serez prévenu des nouveaux messages et abonnés.',
    'notif.blocked': 'Notifications bloquées. Autorisez-les dans les réglages du navigateur ' +
      "(cadenas dans la barre d'adresse).",
    'notif.test': 'Envoyer une notification de test', 'notif.testTitle': 'Koliya — test',
    'notif.testBody': 'Si vous voyez ceci, les notifications fonctionnent.',
    'notif.sent': 'Notification envoyée',
    'notif.unsupported': 'Votre navigateur ne gère pas les notifications',

    'settings.title': 'Réglages', 'settings.language': 'Langue',
    'settings.languageHint': "Change toute l'interface immédiatement.",
    'settings.appearance': 'Apparence', 'settings.theme': 'Thème',
    'settings.light': 'Clair', 'settings.dark': 'Sombre', 'settings.system': 'Système',
    'settings.notifications': 'Notifications',
    'settings.notifHint': 'Alertes pour les nouveaux messages et abonnés, quand Koliya est ouvert.',
    'settings.account': 'Compte', 'settings.signOut': 'Se déconnecter',
    'settings.status.granted': 'Activées', 'settings.status.denied': 'Bloquées par le navigateur',
    'settings.status.default': 'Pas encore activées',

    'error.generic': 'Une erreur est survenue', 'error.network': 'Problème de connexion',
    'error.session': 'Session expirée — reconnectez-vous',
    'error.notFound': 'Introuvable', 'error.loading': 'Chargement impossible',
    'error.saveFailed': 'Enregistrement échoué', 'error.tooHeavy': 'Fichier trop lourd',

    'time.now': "à l'instant", 'time.minute': '{n} min', 'time.hour': '{n} h',
    'time.day': '{n} j', 'time.week': '{n} sem',
    'time.today': "Aujourd'hui", 'time.yesterday': 'Hier'
  },

  ar: {
    'app.name': 'كلية',
    'app.tagline': 'جامعتك في مكان واحد',

    'nav.home': 'الرئيسية', 'nav.explore': 'استكشاف', 'nav.messages': 'الرسائل',
    'nav.notifications': 'الإشعارات', 'nav.hub': 'المركز', 'nav.channels': 'القنوات',
    'nav.events': 'الفعاليات', 'nav.qa': 'الأسئلة', 'nav.saved': 'المحفوظات',
    'nav.leaderboard': 'الترتيب', 'nav.profile': 'حسابي', 'nav.settings': 'الإعدادات',
    'nav.compose': 'إنشاء',

    'action.save': 'حفظ', 'action.cancel': 'إلغاء', 'action.delete': 'حذف',
    'action.confirm': 'تأكيد', 'action.close': 'إغلاق', 'action.retry': 'إعادة المحاولة',
    'action.send': 'إرسال', 'action.publish': 'نشر', 'action.create': 'إنشاء',
    'action.edit': 'تعديل', 'action.reply': 'رد', 'action.share': 'مشاركة',
    'action.report': 'إبلاغ', 'action.block': 'حظر', 'action.follow': 'متابعة',
    'action.unfollow': 'إلغاء المتابعة', 'action.following': 'تتابعه',
    'action.requested': 'طلب مُرسَل', 'action.message': 'مراسلة', 'action.search': 'بحث',
    'action.copy': 'نسخ', 'action.copied': 'تم النسخ', 'action.more': 'المزيد',
    'action.back': 'رجوع', 'action.seeAll': 'عرض الكل', 'action.loadMore': 'تحميل المزيد',

    'feed.forYou': 'لك', 'feed.following': 'من تتابع', 'feed.faculty': 'كليتي',
    'feed.empty.title': 'لا شيء هنا بعد',
    'feed.empty.text': 'كن أول من ينشر اليوم.',
    'feed.placeholder': 'ما الجديد في الجامعة؟',
    'feed.anonymous': 'مجهول', 'feed.poll': 'استطلاع', 'feed.photo': 'صورة',
    'feed.post': 'منشور', 'feed.comments': 'التعليقات',
    'feed.comment.placeholder': 'اكتب تعليقاً…',
    'feed.comment.none': 'لا توجد تعليقات', 'feed.published': 'تم النشر',
    'feed.deleted': 'حُذف المنشور', 'feed.saved': 'حُفظ',
    'feed.unsaved': 'أُزيل من المحفوظات', 'feed.voted': 'صوّتَ من قبل',
    'feed.story.yours': 'قصتك',

    'dm.title': 'الرسائل', 'dm.new': 'رسالة جديدة', 'dm.search': 'بحث…',
    'dm.placeholder': 'اكتب رسالة…', 'dm.empty.title': 'لا محادثات',
    'dm.empty.text': 'ابدأ الحديث مع طلبة كليتك.',
    'dm.sayHi': 'ألقِ التحية', 'dm.online': 'متصل', 'dm.offline': 'آخر ظهور قريباً',
    'dm.typing': 'يكتب…', 'dm.edited': 'مُعدَّل', 'dm.you': 'أنت: ',
    'dm.photo': 'صورة', 'dm.video': 'فيديو', 'dm.voice': 'رسالة صوتية', 'dm.file': 'ملف',
    'dm.folder.all': 'الكل', 'dm.folder.unread': 'غير مقروء', 'dm.folder.pinned': 'مثبَّت',
    'dm.folder.study': 'دراسة', 'dm.folder.muted': 'مكتوم', 'dm.folder.archived': 'الأرشيف',
    'dm.newBelow': 'رسائل جديدة', 'dm.notSent': 'لم تُرسَل الرسالة',
    'dm.info': 'معلومات', 'dm.sharedMedia': 'الوسائط المشتركة', 'dm.files': 'الملفات',
    'dm.links': 'الروابط', 'dm.nickname': 'اسم مستعار', 'dm.theme': 'مظهر المحادثة',
    'dm.export': 'تصدير المحادثة', 'dm.clear': 'إفراغ المحادثة',
    'dm.mute': 'كتم الإشعارات', 'dm.unmute': 'إلغاء الكتم',
    'dm.forward': 'إعادة توجيه', 'dm.noContacts': 'لا يوجد طلبة لمراسلتهم',

    'profile.edit': 'تعديل الحساب', 'profile.posts': 'منشور',
    'profile.followers': 'متابِع', 'profile.following': 'يتابع',
    'profile.streak': 'سلسلة', 'profile.private': 'خاص',
    'profile.privateTitle': 'هذا الحساب خاص',
    'profile.privateText': 'تابِع {name} لرؤية منشوراته.',
    'profile.name': 'الاسم الكامل', 'profile.username': 'اسم المستخدم', 'profile.bio': 'نبذة',
    'profile.faculty': 'الكلية', 'profile.pronouns': 'الضمائر', 'profile.links': 'الروابط',
    'profile.website': 'الموقع', 'profile.privacy': 'الخصوصية',
    'profile.privateAccount': 'حساب خاص',
    'profile.privateHint': 'من تقبلهم فقط يرون منشوراتك وقصصك.',
    'profile.updated': 'تم تحديث الحساب', 'profile.identity': 'الهوية',
    'profile.about': 'نبذة', 'profile.cover': 'الغلاف', 'profile.noPosts': 'لا منشورات',
    'profile.nameWarn.title': 'تغيير اسمك مرة أخرى؟',
    'profile.nameWarn.text': 'غيّرتَ اسمك قبل أقل من ١٥ يوماً. قد لا يعرفك زملاؤك. ' +
      'يُصفَّر العدّاد بعد {days} يوماً.',
    'profile.nameWarn.confirm': 'غيّره على أي حال',
    'profile.nameWarn.cancel': 'أبقِ اسمي',

    'hub.title': 'المركز', 'hub.level': 'المستوى', 'hub.xp': 'مجموع النقاط',
    'hub.streakDays': 'يوماً متتالياً', 'hub.best': 'الأفضل',
    'hub.quests': 'تحدّيات اليوم', 'hub.badges': 'الشارات',
    'hub.leaderboard': 'الترتيب', 'hub.myFaculty': 'كليتي',
    'hub.allCampus': 'كل الجامعة', 'hub.freezeReady': 'التجميد جاهز',
    'hub.freezeUsed': 'استُخدم التجميد',
    'hub.freezeHint': 'يوم واحد فائت سيُعوَّض تلقائياً هذا الشهر',
    'hub.questDone': 'اكتمل التحدي', 'hub.dayComplete': 'اكتملت تحدّيات اليوم',
    'hub.rank': '{rank} في كليتك', 'hub.outOfTop': 'خارج أفضل ٥٠',
    'hub.rankReward': 'تظهر في «طلبة لتكتشفهم»',
    'quest.visit': 'افتح كلية', 'quest.post': 'انشر مرة',
    'quest.comment': 'علّق على ٣ منشورات', 'quest.like': 'أعجِب بـ٥ منشورات',
    'quest.answer': 'أجب عن سؤال', 'quest.story': 'انشر قصة',
    'streak.lost': 'ضاعت السلسلة — صُفِّر {n} يوماً. أكمل تحدّيات اليوم لتبدأ من جديد.',
    'streak.frozen': 'عُوِّض اليوم الفائت بتجميدة الشهر. سلسلتك مستمرة.',

    'events.title': 'الفعاليات', 'events.eyebrow': 'الجامعة',
    'events.sub': 'مراجعات ومحاضرات وخرجات — كل ما يحدث حولك.',
    'events.upcoming': 'قادمة', 'events.yours': 'تشارك فيها',
    'events.create': 'أنشئ\nفعالية', 'events.attend': 'سأحضر',
    'events.attending': 'مسجَّل', 'events.none': 'لا شيء مبرمج حالياً',
    'events.when': 'التاريخ والوقت', 'events.where': 'المكان', 'events.what': 'الوصف',
    'qa.title': 'أسئلة وأجوبة', 'qa.eyebrow': 'تعاون',
    'qa.sub': 'اسأل ما لا تجرؤ على سؤاله في المدرج. بلا اسم إن أردت.',
    'qa.count': 'سؤال', 'qa.unanswered': 'بلا إجابة',
    'qa.ask': 'اطرح\nسؤالاً', 'qa.answer': 'أجب', 'qa.bestAnswer': 'أفضل إجابة',
    'qa.anonymous': 'ابقَ مجهولاً',
    'qa.anonymousHint': 'اسمك لن يغادر الخادم أبداً',
    'qa.none': 'لا أسئلة — اطرح سؤالك',
    'channels.title': 'القنوات', 'channels.join': 'انضم', 'channels.joined': 'منضمّ',
    'channels.members': 'عضو', 'channels.create': 'أنشئ قناة',
    'explore.title': 'استكشاف', 'explore.trends': 'الأكثر تداولاً',
    'explore.people': 'أشخاص', 'explore.discover': 'طلبة لتكتشفهم',
    'saved.title': 'المحفوظات', 'saved.none': 'لا شيء محفوظ',

    'notif.title': 'الإشعارات', 'notif.all': 'الكل', 'notif.mentions': 'الإشارات',
    'notif.follows': 'المتابعات', 'notif.none': 'لا جديد',
    'notif.markAllRead': 'تعليم الكل كمقروء', 'notif.accept': 'قبول', 'notif.decline': 'رفض',
    'notif.enable': 'هل تريد تنبيهك بالرسائل الجديدة؟',
    'notif.enableBtn': 'تفعيل', 'notif.enabled': 'فُعِّلت الإشعارات',
    'notif.enabledBody': 'سنخبرك بالرسائل والمتابعين الجدد.',
    'notif.blocked': 'الإشعارات محظورة. اسمح بها من إعدادات المتصفح (القفل في شريط العنوان).',
    'notif.test': 'أرسل إشعاراً تجريبياً', 'notif.testTitle': 'كلية — تجربة',
    'notif.testBody': 'إن رأيت هذا فالإشعارات تعمل.',
    'notif.sent': 'أُرسل الإشعار', 'notif.unsupported': 'متصفحك لا يدعم الإشعارات',

    'settings.title': 'الإعدادات', 'settings.language': 'اللغة',
    'settings.languageHint': 'تُغيّر الواجهة كلها فوراً.',
    'settings.appearance': 'المظهر', 'settings.theme': 'السمة',
    'settings.light': 'فاتح', 'settings.dark': 'داكن', 'settings.system': 'حسب النظام',
    'settings.notifications': 'الإشعارات',
    'settings.notifHint': 'تنبيهات للرسائل والمتابعين الجدد ما دام كلية مفتوحاً.',
    'settings.account': 'الحساب', 'settings.signOut': 'تسجيل الخروج',
    'settings.status.granted': 'مفعَّلة', 'settings.status.denied': 'محظورة من المتصفح',
    'settings.status.default': 'غير مفعَّلة بعد',

    'error.generic': 'حدث خطأ', 'error.network': 'مشكلة في الاتصال',
    'error.session': 'انتهت الجلسة — سجّل الدخول من جديد',
    'error.notFound': 'غير موجود', 'error.loading': 'تعذّر التحميل',
    'error.saveFailed': 'فشل الحفظ', 'error.tooHeavy': 'الملف كبير جداً',

    'time.now': 'الآن', 'time.minute': '{n} د', 'time.hour': '{n} س',
    'time.day': '{n} ي', 'time.week': '{n} أ',
    'time.today': 'اليوم', 'time.yesterday': 'أمس'
  }
};

/* ============================================================
   RUNTIME
   ============================================================ */

let current = DEFAULT_LANG;

export const lang = () => current;
export const dir = () => (LANGS.find(l => l.id === current)?.dir || 'ltr');
export const isRTL = () => dir() === 'rtl';

/**
 * Translate. Falls back through: current -> English -> the key.
 * Returning the key makes a missing string visible instead of
 * leaving a blank space nobody notices.
 */
export function t(key, vars = null) {
  let s = STRINGS[current]?.[key] ?? STRINGS[DEFAULT_LANG]?.[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** Set the language, paint it, and remember it. */
export function setLang(id, { silent = false } = {}) {
  const found = LANGS.find(l => l.id === id);
  if (!found) return current;

  current = found.id;
  prefs.locale = found.id;                 // persists + fires 'locale'

  document.documentElement.lang = found.id;
  document.documentElement.dir = found.dir;
  document.documentElement.dataset.lang = found.id;

  applyI18n();
  if (!silent) emit('i18n:changed', found.id);
  return current;
}

/**
 * Fill every [data-i18n] in the tree.
 *   data-i18n          -> textContent
 *   data-i18n-attr     -> "placeholder:key, aria-label:key"
 */
export function applyI18n(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':').map(x => x.trim());
      if (attr && key) node.setAttribute(attr, t(key));
    }
  }
  for (const node of root.querySelectorAll('[data-i18n-tip]')) {
    node.setAttribute('data-tip', t(node.dataset.i18nTip));
  }
}

/**
 * Resolve the startup language: saved choice, else the browser's,
 * else English. A student whose phone is Arabic should not have to
 * hunt for the switcher on first run.
 */
export function initI18n() {
  const saved = prefs.locale;
  const known = LANGS.some(l => l.id === saved);
  if (known) return setLang(saved, { silent: true });

  const nav = (navigator.languages?.[0] || navigator.language || '').slice(0, 2).toLowerCase();
  const guess = LANGS.some(l => l.id === nav) ? nav : DEFAULT_LANG;
  return setLang(guess, { silent: true });
}

/** Keys defined per language — used by the tests to spot gaps. */
export const coverage = () =>
  Object.fromEntries(Object.entries(STRINGS).map(([k, v]) => [k, Object.keys(v).length]));

export default { t, lang, dir, isRTL, setLang, applyI18n, initI18n, LANGS, DEFAULT_LANG };
