#!/usr/bin/env python3
"""
patch_v15_web.py — channel role wording.

THE BUG
There are TWO different `role` columns in the schema, and both used the
word "admin":

    profiles.role        = 'student' | 'admin'   -> UNIVERSITY STAFF
    channel_members.role = 'owner' | 'admin' | 'member'
                                                 -> moderator of ONE channel

So a student who created a study channel was labelled "Admin", exactly
like university staff, and the manage panel said "Admins only" — which
read as "only the university may post here".

The data model is correct and untouched. Only the words change:

    channel owner  -> Creator            (the student who made it)
    channel admin  -> Moderator          (a student they promoted)
    profiles.role  -> University staff   (actual faculty)

Idempotent. Run after any rollback.
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
P = lambda *a: os.path.join(ROOT, 'public', *a)
done, skip = [], []


def edit(path, label, fn):
    with open(path, encoding='utf-8') as f:
        before = f.read()
    after = fn(before)
    if after is None:
        skip.append(label)
        return
    with open(path, 'w', encoding='utf-8') as f:
        f.write(after)
    done.append(label)


def i18n(s):
    if "'channels.role.owner': 'Creator'" in s:
        return None

    reps = [
        # ---- English
        ("    'channels.role.owner': 'Owner', 'channels.role.admin': 'Admin', 'channels.role.member': 'Member',",
         "    'channels.role.owner': 'Creator', 'channels.role.admin': 'Moderator', 'channels.role.member': 'Member',"),
        ("    'channels.promote': 'Make admin', 'channels.demote': 'Remove admin',",
         "    'channels.promote': 'Make moderator', 'channels.demote': 'Remove moderator',"),
        ("    'channels.adminsOnly': 'Admins only',",
         "    'channels.adminsOnly': 'Moderators only',"),
        ("    'channels.readOnly': 'Only admins can post here',",
         "    'channels.readOnly': 'Only moderators can post here',"),
        ("    'channels.readOnlyWhy': 'You can read everything. Ask an admin to post.',",
         "    'channels.readOnlyWhy': 'You can read everything. Ask a moderator to post.',"),
        ("    'channels.privateWhy': 'People must ask to join, and an admin lets them in.',",
         "    'channels.privateWhy': 'People must ask to join, and a moderator lets them in.',"),
        ("    'channels.requestSent': 'Request sent to the admins of {name}',",
         "    'channels.requestSent': 'Request sent to the moderators of {name}',"),
        ("    'profile.card': 'Student card',",
         "    'profile.card': 'Student card',\n    'profile.staff': 'University staff',"),
        # ---- French
        ("    'channels.role.owner': 'Propriétaire', 'channels.role.admin': 'Admin', 'channels.role.member': 'Membre',",
         "    'channels.role.owner': 'Créateur', 'channels.role.admin': 'Modérateur', 'channels.role.member': 'Membre',"),
        ("    'channels.promote': 'Nommer admin', 'channels.demote': 'Retirer admin',",
         "    'channels.promote': 'Nommer modérateur', 'channels.demote': 'Retirer modérateur',"),
        ("    'channels.adminsOnly': 'Admins seulement',",
         "    'channels.adminsOnly': 'Modérateurs seulement',"),
        ("    'channels.readOnly': 'Seuls les admins peuvent publier ici',",
         "    'channels.readOnly': 'Seuls les modérateurs peuvent publier ici',"),
        ("    'channels.readOnlyWhy': 'Vous pouvez tout lire. Demandez à un admin de publier.',",
         "    'channels.readOnlyWhy': 'Vous pouvez tout lire. Demandez à un modérateur de publier.',"),
        ("    'channels.privateWhy': 'Il faut demander à rejoindre, et un admin accepte.',",
         "    'channels.privateWhy': 'Il faut demander à rejoindre, et un modérateur accepte.',"),
        ("    'channels.requestSent': 'Demande envoyée aux admins de {name}',",
         "    'channels.requestSent': 'Demande envoyée aux modérateurs de {name}',"),
        ("    'profile.card': 'Carte étudiant',",
         "    'profile.card': 'Carte étudiant',\n    'profile.staff': 'Personnel universitaire',"),
        # ---- Arabic. مشرف alone was ambiguous; "مشرف القناة" pins it
        #      to this one channel, and إدارة الجامعة is clearly faculty.
        ("    'channels.role.owner': 'المالك', 'channels.role.admin': 'مشرف', 'channels.role.member': 'عضو',",
         "    'channels.role.owner': 'المُنشئ', 'channels.role.admin': 'مشرف القناة', 'channels.role.member': 'عضو',"),
        ("    'channels.promote': 'تعيين مشرفاً', 'channels.demote': 'إزالة الإشراف',",
         "    'channels.promote': 'تعيين مشرفاً للقناة', 'channels.demote': 'إزالة الإشراف',"),
        ("    'channels.adminsOnly': 'المشرفون فقط',",
         "    'channels.adminsOnly': 'مشرفو القناة فقط',"),
        ("    'channels.readOnly': 'المشرفون وحدهم يمكنهم النشر هنا',",
         "    'channels.readOnly': 'مشرفو القناة وحدهم يمكنهم النشر هنا',"),
        ("    'channels.readOnlyWhy': 'يمكنك قراءة كل شيء. اطلب من مشرف أن ينشر.',",
         "    'channels.readOnlyWhy': 'يمكنك قراءة كل شيء. اطلب من مشرف القناة أن ينشر.',"),
        ("    'channels.privateWhy': 'يجب طلب الانضمام، ويقبله أحد المشرفين.',",
         "    'channels.privateWhy': 'يجب طلب الانضمام، ويقبله أحد مشرفي القناة.',"),
        ("    'channels.requestSent': 'أُرسل الطلب إلى مشرفي {name}',",
         "    'channels.requestSent': 'أُرسل الطلب إلى مشرفي قناة {name}',"),
        ("    'profile.card': 'بطاقة الطالب',",
         "    'profile.card': 'بطاقة الطالب',\n    'profile.staff': 'إدارة الجامعة',"),
    ]
    out = s
    missing = []
    for a, b in reps:
        if out.count(a) == 1:
            out = out.replace(a, b)
        else:
            missing.append(a[:46])
    if missing:
        sys.stderr.write('  note: %d anchors not found (already renamed?)\n'
                         % len(missing))
    return out if out != s else None


def profile(s):
    if "t('profile.staff')" in s:
        return None
    a = """      ${u.role === 'admin' ? '<span class="pill on">Admin</span>' : ''}"""
    if a not in s:
        return None
    # profiles.role='admin' is UNIVERSITY STAFF. A bare "Admin" pill sat
    # next to channels that also have "admins", so a student who created
    # a study channel looked like faculty.
    return s.replace(a, """      ${u.role === 'admin' ? `<span class="pill on">${esc(t('profile.staff'))}</span>` : ''}""")


edit(P('js/core/i18n_sm.js'), 'i18n (Creator / Moderator / University staff)', i18n)
edit(P('js/features/profile_sm.js'), 'profile_sm (staff pill)', profile)

print('  patched: ' + (', '.join(done) or 'nothing'))
if skip:
    print('  already current: ' + ', '.join(skip))
