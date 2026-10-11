import { describe, expect, it } from 'vitest'
import { detectCheckpoint, type PageFacts } from './checkpoints'

const page = (p: Partial<PageFacts>): PageFacts => ({ url: 'https://www.instagram.com/', title: 'Instagram', text: '', frameUrls: [], ...p })

// A realistic logged-in feed (long text) — used as the backdrop for weak-phrase negatives.
const IG_FEED = `Instagram
Home
Search
Explore
Reels
Messages
Notifications
Create
Profile
More
Your story
ffdevstudio
ascend.my
${Array.from({ length: 30 }, (_, i) => `user_${i} • ${i + 1}h
Follow
Sunset over the Klang valley, shot on a phone. Who else was out tonight? #kl #sunset
Liked by someone and ${200 + i} others
View all ${10 + i} comments
Add a comment…`).join('\n')}
Suggested for you
See All
About · Help · Press · API · Jobs · Privacy · Terms · Locations · Language · Meta Verified
© 2026 INSTAGRAM FROM META`

describe('detectCheckpoint — positives', () => {
  it('Instagram challenge URL', () => {
    const r = detectCheckpoint(page({ url: 'https://www.instagram.com/challenge/?next=/ffdevstudio/', title: 'Instagram', text: 'Help us confirm it’s you' }))
    expect(r?.kind).toBe('checkpoint')
    expect(r?.reason).toMatch(/Instagram/)
  })

  it('Instagram "Try Again Later" rate-limit dialog over a long feed', () => {
    const r = detectCheckpoint(
      page({
        text: IG_FEED + '\nTry Again Later\nWe limit how often you can do certain things on Instagram to protect our community. Tell us if you think we made a mistake.\nTell us\nOK',
        dialogText: 'Try Again Later We limit how often you can do certain things on Instagram to protect our community. Tell us if you think we made a mistake. Tell us OK'
      })
    )
    expect(r?.kind).toBe('rate_limit')
  })

  it('Instagram Action Blocked dialog (weak phrase inside a dialog)', () => {
    const r = detectCheckpoint(page({ text: IG_FEED, dialogText: 'Action Blocked\nPlease try again later.\nOK' }))
    expect(r?.kind).toBe('rate_limit')
  })

  it('Instagram action blocked wording (strong)', () => {
    const r = detectCheckpoint(page({ text: IG_FEED + '\nThis action was blocked. Please try again later. We restrict certain content and actions to protect our community.' }))
    expect(r?.kind).toBe('rate_limit')
  })

  it('Instagram suspended account page', () => {
    expect(detectCheckpoint(page({ url: 'https://www.instagram.com/accounts/suspended/?next=%2F', text: 'We suspended your account, ffdevstudio' }))?.kind).toBe('checkpoint')
  })

  it('Instagram automated behaviour warning', () => {
    const text = IG_FEED + '\nWe suspect automated behavior on your account\nTo protect your account, we restrict certain activity. Dismiss'
    expect(detectCheckpoint(page({ text }))?.kind).toBe('checkpoint')
  })

  it('Instagram logged out → login wall', () => {
    expect(detectCheckpoint(page({ url: 'https://www.instagram.com/accounts/login/?next=%2F', text: 'Phone number, username, or email\nPassword\nLog in' }))?.kind).toBe('login_wall')
    const landing = detectCheckpoint(page({ url: 'https://www.instagram.com/', text: 'Instagram\nPhone number, username, or email\nPassword\nLog in\nOR\nLog in with Facebook\nForgot password?\nDon\'t have an account? Sign up' }))
    expect(landing?.kind).toBe('login_wall')
  })

  it('Facebook checkpoint URL', () => {
    const r = detectCheckpoint(page({ url: 'https://www.facebook.com/checkpoint/1501092823525282/?next=https%3A%2F%2Fwww.facebook.com%2F', title: 'Facebook', text: 'Your account has been locked\nWe noticed unusual activity on your account.' }))
    expect(r?.kind).toBe('checkpoint')
    expect(r?.reason).toMatch(/Facebook/)
  })

  it('Facebook temporarily blocked', () => {
    const text = 'Facebook\nYou’re Temporarily Blocked\nIt looks like you were misusing this feature by going too fast. You’ve been temporarily blocked from using it.\nOK'
    expect(detectCheckpoint(page({ url: 'https://www.facebook.com/reels/create/', text }))?.kind).toBe('rate_limit')
  })

  it('Facebook login page', () => {
    expect(detectCheckpoint(page({ url: 'https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2F', text: 'Log into Facebook' }))?.kind).toBe('login_wall')
    expect(detectCheckpoint(page({ url: 'https://www.facebook.com/', title: 'Facebook – log in or sign up', text: 'Facebook helps you connect and share with the people in your life.\nLog in\nForgotten password?\nCreate new account' }))?.kind).toBe('login_wall')
  })

  it('Meta "Help us confirm it\'s you" (curly apostrophe)', () => {
    expect(detectCheckpoint(page({ url: 'https://www.facebook.com/', text: 'Help us confirm it’s you\nTo continue, we need to confirm this account belongs to you.' }))?.kind).toBe('checkpoint')
  })

  it('TikTok slider puzzle in the page + verify-center frame', () => {
    expect(detectCheckpoint(page({ url: 'https://www.tiktok.com/tiktokstudio/upload', title: 'TikTok Studio', text: 'Verify to continue:\nDrag the slider to fit the puzzle\nRefresh\nReport a problem' }))?.kind).toBe('captcha')
    expect(detectCheckpoint(page({ url: 'https://www.tiktok.com/tiktokstudio/upload', title: 'TikTok Studio', text: 'Upload', frameUrls: ['https://rmc.bytedance.com/verifycenter/captcha/v2?lang=en&app_name=&h5_sdk_version=2.33.7'] }))?.kind).toBe('captcha')
    expect(detectCheckpoint(page({ url: 'https://www.tiktok.com/', frameUrls: ['https://verification.tiktok.com/view?aid=1988&host=https%3A%2F%2Fverification.tiktok.com'] }))?.kind).toBe('captcha')
  })

  it('TikTok 3D shape puzzle and attempts limit', () => {
    expect(detectCheckpoint(page({ url: 'https://www.tiktok.com/upload', text: 'Select 2 objects that are the same shape:\nConfirm' }))?.kind).toBe('captcha')
    expect(detectCheckpoint(page({ url: 'https://www.tiktok.com/login/phone-or-email', text: 'Maximum number of attempts reached. Try again later.' }))?.kind).toBe('login_wall')
    expect(detectCheckpoint(page({ url: 'https://www.tiktok.com/tiktokstudio/upload', text: 'Maximum number of attempts reached. Try again later.' }))?.kind).toBe('rate_limit')
  })

  it('X: Arkose frame on account access + locked text', () => {
    const r = detectCheckpoint(page({ url: 'https://x.com/account/access', title: 'X', text: 'Your account has been locked.\nAuthenticate\nStart', frameUrls: ['https://client-api.arkoselabs.com/v2/2CB16598-CB82-4CF7-B332-5990DB66F3AB/enforcement.6cf4ab9ab33f16f7cc6dd27cfb9d36d5.html'] }))
    expect(r?.kind).toBe('captcha')
    expect(detectCheckpoint(page({ url: 'https://x.com/account/access', title: 'X', text: 'Your account has been locked.' }))?.kind).toBe('checkpoint')
  })

  it('X: daily limit + limited features + login flow', () => {
    expect(detectCheckpoint(page({ url: 'https://x.com/compose/post', text: 'Home\nWhoa there!\nYou are over the daily limit for sending posts.' }))?.kind).toBe('rate_limit')
    expect(detectCheckpoint(page({ url: 'https://x.com/home', text: "We've temporarily limited some of your account features.\nContinue to X" }))?.kind).toBe('checkpoint')
    expect(detectCheckpoint(page({ url: 'https://x.com/i/flow/login', title: 'Log in to X / X', text: 'Sign in to X' }))?.kind).toBe('login_wall')
  })

  it('LinkedIn security check + authwall', () => {
    expect(detectCheckpoint(page({ url: 'https://www.linkedin.com/checkpoint/challenge/AgG1xyz?ut=2abc', title: 'Security Verification | LinkedIn', text: "Let's do a quick security check" }))?.kind).toBe('checkpoint')
    expect(detectCheckpoint(page({ url: 'https://www.linkedin.com/authwall?trk=bf&trkInfo=AQ', text: 'Join LinkedIn' }))?.kind).toBe('login_wall')
    expect(detectCheckpoint(page({ url: 'https://www.linkedin.com/feed/', text: 'Your account has been restricted\nWe’ve restricted your account temporarily.' }))?.kind).toBe('checkpoint')
  })

  it('YouTube: Google sign-in + challenge + upload limit + sorry page', () => {
    expect(detectCheckpoint(page({ url: 'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fstudio.youtube.com%2F&service=youtube', text: 'Sign in\nto continue to YouTube' }))?.kind).toBe('login_wall')
    expect(detectCheckpoint(page({ url: 'https://accounts.google.com/v3/signin/challenge/pwd?TL=abc', text: "Verify it's you" }))?.kind).toBe('checkpoint')
    expect(detectCheckpoint(page({ url: 'https://studio.youtube.com/channel/UC123/videos/upload?d=ud', title: 'Channel content - YouTube Studio', text: 'Daily upload limit reached\nYou can upload more videos in 24 hours.' }))?.kind).toBe('rate_limit')
    expect(detectCheckpoint(page({ url: 'https://www.google.com/sorry/index?continue=https://www.youtube.com/', text: 'Our systems have detected unusual traffic from your computer network.' }))?.kind).toBe('captcha')
  })

  it('captcha iframes of every vendor', () => {
    const frames = [
      'https://www.google.com/recaptcha/api2/bframe?hl=en&v=abc&k=6Lc',
      'https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1&k=6Le&co=aHR0&hl=en&size=normal',
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=challenge',
      'https://iframe.arkoselabs.com/B7D8911C-5CC8-A9A3-35B0-554ACEE604DA/index.html',
      'https://api.funcaptcha.com/fc/gc/?token=abc',
      'https://static.geetest.com/static/js/gt.0.5.0.js',
      'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv0/0/abc/normal'
    ]
    for (const f of frames) expect(detectCheckpoint(page({ url: 'https://www.linkedin.com/feed/', text: 'Feed', frameUrls: [f] }))?.kind, f).toBe('captcha')
  })

  it('human checks on unknown hosts', () => {
    expect(detectCheckpoint(page({ url: 'https://example.org/upload', title: 'Just a moment...', text: 'Verify you are human by completing the action below.' }))?.kind).toBe('captcha')
    expect(detectCheckpoint(page({ url: 'https://example.org/', text: 'Please confirm you’re human to continue.' }))?.kind).toBe('captcha')
  })

  it('rate-limit phrases', () => {
    expect(detectCheckpoint(page({ text: 'Please wait a few minutes before you try again.' }))?.kind).toBe('rate_limit')
    expect(detectCheckpoint(page({ url: 'https://www.threads.com/', text: 'Try again later\nWe limit how often you can post.' }))?.kind).toBe('rate_limit')
    expect(detectCheckpoint(page({ url: 'https://www.tiktok.com/tiktokstudio/upload', title: 'Too many requests', text: 'x'.repeat(5000) }))?.kind).toBe('rate_limit')
  })

  it('weak phrases count on a short page', () => {
    expect(detectCheckpoint(page({ url: 'https://www.instagram.com/', text: 'Something went wrong.\nThere’s an issue and the page could not be loaded. Try again later.' }))?.kind).toBe('rate_limit')
    expect(detectCheckpoint(page({ url: 'https://www.facebook.com/', text: 'We noticed suspicious activity. Confirm your identity to continue.' }))?.kind).toBe('checkpoint')
  })

  it('login code prompt', () => {
    expect(detectCheckpoint(page({ url: 'https://www.instagram.com/accounts/login/two_factor?next=%2F', text: 'Enter the 6-digit code we sent to the number ending in 12.' }))?.kind).toBe('login_wall')
    expect(detectCheckpoint(page({ url: 'https://www.threads.com/', text: IG_FEED + '\nEnter the code we sent to f***@g***.com' }))?.kind).toBe('checkpoint')
  })
})

describe('detectCheckpoint — negatives', () => {
  it('a normal Instagram feed', () => {
    expect(detectCheckpoint(page({ text: IG_FEED }))).toBeNull()
  })

  it('a feed post whose caption mentions captcha / try again later / unusual activity', () => {
    const text = IG_FEED.replace(
      'Sunset over the Klang valley',
      'Solved my first captcha today lol, the bot detection is wild. Servers were down, try again later they said. Unusual activity in the market today'
    )
    expect(detectCheckpoint(page({ text }))).toBeNull()
  })

  it('an invisible reCAPTCHA anchor frame does not count', () => {
    expect(detectCheckpoint(page({ text: IG_FEED, frameUrls: ['https://www.google.com/recaptcha/enterprise/anchor?ar=1&k=6Lc&hl=en&v=x&size=invisible&cb=abc'] }))).toBeNull()
  })

  it('a settings page that lists password / two-factor / login activity links', () => {
    const text = `Settings
How you use Instagram
Edit profile
Notifications
Who can see your content
Account privacy
Close Friends
Blocked
Restricted accounts
Password and security
Two-factor authentication
Login activity
Saved login info
Security checkup
Accounts Center
Manage your connected experiences and account settings across Meta technologies.
${'Personal details\nAd preferences\n'.repeat(80)}`
    expect(detectCheckpoint(page({ url: 'https://www.instagram.com/accounts/edit/', title: 'Edit profile • Instagram', text }))).toBeNull()
  })

  it('a TikTok Studio upload page with a filename containing "captcha"', () => {
    const text = 'TikTok Studio\nUpload\nSelect video to upload\nOr drag and drop it here\ncaptcha-explainer-final.mp4\nDescription\n0/4000\nCover\nWho can watch this video\nEveryone\nPost\nDiscard'.padEnd(1600, ' Settings')
    expect(detectCheckpoint(page({ url: 'https://www.tiktok.com/tiktokstudio/upload?from=webapp', title: 'TikTok Studio', text }))).toBeNull()
  })

  it('a local fixture page with a /login path is not a platform login wall', () => {
    expect(detectCheckpoint(page({ url: 'file:///C:/fixtures/login/index.html', title: 'Fixture', text: 'Hello' }))).toBeNull()
    expect(detectCheckpoint(page({ url: 'http://127.0.0.1:5173/login', title: 'Dev', text: 'Sign in' }))).toBeNull()
  })

  it('X home timeline and LinkedIn feed', () => {
    expect(detectCheckpoint(page({ url: 'https://x.com/home', title: 'Home / X', text: 'For you\nFollowing\nWhat is happening?!\nPost\n' + 'Some tweet about lunch\n'.repeat(200) }))).toBeNull()
    expect(detectCheckpoint(page({ url: 'https://www.linkedin.com/feed/', title: 'Feed | LinkedIn', text: 'Start a post\nVideo\nPhoto\nWrite article\n' + 'Excited to share that we shipped a thing!\n'.repeat(100) }))).toBeNull()
  })

  it('empty facts', () => {
    expect(detectCheckpoint({ url: '', title: '', text: '', frameUrls: [] })).toBeNull()
  })
})
