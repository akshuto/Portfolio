AKSHUTO PORTFOLIO — README
===========================

HOW THIS SITE WORKS NOW
-------------------------
This site is "live-editable": index.html and projects.html pull your
profile picture and project list from a small free database (Firebase
Firestore) in real time. You manage everything from admin.html — a
private page only you should know the address of.

WHAT'S IN THIS FOLDER
----------------------
index.html        Home page (public)
projects.html     Work page (public, with filters)
about.html        About page (public)
contact.html      Contact page (public)
admin.html        YOUR private editing dashboard — do not link to this from the public site
                  Now has TWO tabs inside it: "Portfolio" (profile pic, projects) and
                  "Tracker" (your Ledger: dashboard, projects, invoices, settings) —
                  both behind the same single login.
styles.css        Shared visual styling
admin.css         Extra styling just for the admin dashboard
script.js         Mobile menu, copy-email, contact form
site-data.js      Loads your profile pic + projects onto the public pages
admin.js          Powers the admin dashboard (login, upload, add/delete)
firebase-init.js  Connects everything to your Firebase project — holds your config
tracker.js        Powers the Tracker tab inside admin.html (Ledger: projects, invoices, settings)

BEFORE THIS WORKS, FINISH THESE ONE-TIME SETUP STEPS
--------------------------------------------------------
1. In Firebase console: Firestore Database created, Authentication (Email/
   Password) enabled, and one user added (your email + a password).
2. In firebase-init.js: fill in CLOUDINARY_CLOUD_NAME and
   CLOUDINARY_UPLOAD_PRESET with the values from your Cloudinary account
   (Cloudinary is used to host your images/videos for free, since Firebase
   Storage now requires a billing account).
3. In the Firebase console, go to Firestore Database → Rules, and paste in
   the rules block below, then click Publish:

     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /projects/{projectId} {
           allow read: if true;
           allow write: if request.auth != null;
         }
         match /site/{docId} {
           allow read: if true;
           allow write: if request.auth != null;
         }
         match /tracker_projects/{docId} {
           allow read, write: if request.auth != null;
         }
         match /tracker_invoices/{docId} {
           allow read, write: if request.auth != null;
         }
         match /tracker_meta/{docId} {
           allow read, write: if request.auth != null;
         }
       }
     }

   This means: anyone can view your projects and profile pic, but only
   someone logged in (you) can add, edit, or delete anything.

USING THE ADMIN DASHBOARD
----------------------------
Go to yoursite.com/admin.html (or your github.io URL), log in with the
email/password you created in Firebase Authentication. Logging in only
lasts until you close the tab/browser — after that you'll need to log in
again, on purpose, for security.

From the dashboard:
- Upload a new profile picture — it updates everywhere instantly.
- Add a project: title, short description, category, whether it should
  also show on the home page ("featured"), and one or more files.
  - Select ONE file → it's added as a single image or video.
  - Select MULTIPLE files (Ctrl/Cmd-click, or drag-select) → they're
    added together as a "folder" — visitors see one card with a photo
    count badge, and clicking it opens all the images at once.
- Delete any project (single or folder) from the list at the bottom.

Changes appear on your live site immediately for every visitor.

KEEP admin.html PRIVATE
--------------------------
Nothing links to admin.html from the public pages on purpose. Anyone who
knows the exact address could still try to log in, but without your
password they can't get past the login screen or change anything (the
Firestore rules above enforce that on the database side too, not just in
the page itself).

GETTING IT ONLINE FOR FREE
-----------------------------
Same as before — push all these files (including the assets folder) to
your GitHub repository, keep the CNAME file and custom domain settings
you already configured, and your domain will serve the updated site.

Easiest option — GitHub Pages:
1. Push/upload all files in this folder to your existing "portfolio" repo.
2. Settings → Pages should already show your custom domain (akshuto.me).
3. Give it a few minutes, then refresh your live site.

Alternative — Netlify (drag and drop, no account needed to preview):
1. Go to app.netlify.com/drop
2. Drag this whole folder into the browser window.
3. Netlify gives you an instant free live link.

