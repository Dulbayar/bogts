// pay.toglii.com was the ggwp-pay Worker's address (QPay, retired
// 2026-09-30). Payments now go through Bogts at checkout.toglii.com, so any
// old link lands there, path and query kept.
export default {
	fetch(request) {
		const url = new URL(request.url);
		return Response.redirect(`https://checkout.toglii.com${url.pathname}${url.search}`, 301);
	}
};
