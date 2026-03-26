/**
 * Strava OAuth callback — redirects to app via deep link.
 * Receives ?code=XXX from Strava → 302 redirects to marathon-coach://strava-callback?code=XXX
 */

Deno.serve((req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const scope = url.searchParams.get('scope');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return new Response('Authorization failed. Return to Gati and try again.', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Direct 302 redirect to the app's deep link
  const appUrl = `marathon-coach://strava-callback?code=${encodeURIComponent(code)}&scope=${encodeURIComponent(scope || '')}`;

  return new Response(null, {
    status: 302,
    headers: { 'Location': appUrl },
  });
});
