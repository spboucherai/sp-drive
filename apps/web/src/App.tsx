// Routes. Public pages (share links, deposit portals, sign-in) never load the signed-in application.
import { lazy, Suspense, useEffect } from 'react';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { useAuth, useRefreshAuth } from './session.ts';
import { ErrorState, Loading } from './ui.tsx';

const Shell = lazy(() => import('./shell/Shell.tsx').then((m) => ({ default: m.Shell })));
const Explorer = lazy(() => import('./explorer/Explorer.tsx').then((m) => ({ default: m.Explorer })));
const Shares = lazy(() => import('./screens/Shares.tsx').then((m) => ({ default: m.Shares })));
const Requests = lazy(() => import('./screens/Requests.tsx').then((m) => ({ default: m.Requests })));
const RequestDetail = lazy(() => import('./screens/RequestDetail.tsx').then((m) => ({ default: m.RequestDetail })));
const Settings = lazy(() => import('./screens/Settings.tsx').then((m) => ({ default: m.Settings })));
const Admin = lazy(() => import('./screens/Admin.tsx').then((m) => ({ default: m.Admin })));
const Login = lazy(() => import('./screens/Login.tsx').then((m) => ({ default: m.Login })));
const Invite = lazy(() => import('./screens/Invite.tsx').then((m) => ({ default: m.Invite })));
const Recovery = lazy(() => import('./screens/Recovery.tsx').then((m) => ({ default: m.Recovery })));
const SharePage = lazy(() => import('./public-pages/SharePage.tsx').then((m) => ({ default: m.SharePage })));
const RequestPage = lazy(() => import('./public-pages/RequestPage.tsx').then((m) => ({ default: m.RequestPage })));

function Private() {
  const { state, loading, error, refetch } = useAuth();
  const refresh = useRefreshAuth();
  const [loc, navigate] = useLocation();
  useEffect(() => { const h = () => { void refresh(); }; window.addEventListener('spd:unauthenticated', h); return () => window.removeEventListener('spd:unauthenticated', h); }, [refresh]);
  if (loading) return <Loading />;
  if (error || !state) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!state.authenticated) return <Redirect to={loc === '/' ? '/login' : `/login?next=${encodeURIComponent(loc)}`} />;
  if (state.recovery) return <Redirect to="/recovery" />; // a recovery session can only enrol a passkey
  return (
    <Shell>
      <Switch>
        <Route path="/"><Explorer view="folder" folderId="root" /></Route>
        <Route path="/folder/:id">{(p) => <Explorer view="folder" folderId={p.id} />}</Route>
        <Route path="/recent"><Explorer view="recent" /></Route>
        <Route path="/starred"><Explorer view="starred" /></Route>
        <Route path="/trash"><Explorer view="trash" /></Route>
        <Route path="/search"><Explorer view="search" /></Route>
        <Route path="/duplicates"><Explorer view="duplicates" /></Route>
        <Route path="/shares"><Shares /></Route>
        <Route path="/requests"><Requests /></Route>
        <Route path="/requests/:id">{(p) => <RequestDetail id={p.id} />}</Route>
        <Route path="/settings/:tab?">{(p) => <Settings tab={p.tab} />}</Route>
        <Route path="/admin">{state.user?.role === 'admin' ? <Admin /> : <Redirect to="/" />}</Route>
        <Route><ErrorState error={{ code: 'not_found' }} onRetry={() => navigate('/')} /></Route>
      </Switch>
    </Shell>
  );
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Switch>
        <Route path="/s/:token">{(p) => <SharePage token={p.token} />}</Route>
        <Route path="/request/:token">{(p) => <RequestPage token={p.token} />}</Route>
        <Route path="/invite/:token">{(p) => <Invite token={p.token} />}</Route>
        <Route path="/login"><Login /></Route>
        <Route path="/recovery"><Recovery /></Route>
        <Route><Private /></Route>
      </Switch>
    </Suspense>
  );
}
