SCOOTLINK INTEGRATION FILES
============================

Files included:
  src/App.jsx           — Drop in as your new App.jsx
  src/pages/LandingPage.jsx — Drop in as src/pages/LandingPage.jsx

Manual change required in your existing Auth.jsx:
  Find the two lines that say:  navigate('/')
  Change both to:               navigate('/app')
  (These are the post-login redirect after sign-in and password recovery.)

Also copy logo.png into your public/ folder if not already there.
