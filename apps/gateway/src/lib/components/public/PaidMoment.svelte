<!--
	The paid moment: a brass coin drops into the pouch, the pouch settles, a
	check appears. CSS only, plays once; with reduced motion it is the final
	frame. Decorative: the page's heading says what happened.
-->
<div class="moment" aria-hidden="true">
	<span class="coin"><span class="hole"></span></span>
	<svg class="pouch" viewBox="0 0 32 32" width="96" height="96">
		<path d="M11.6 12.6 9.7 7.3c-.3-.9.6-1.6 1.4-1.2l2.3 1.1L16 5l2.6 2.2 2.3-1.1c.8-.4 1.7.3 1.4 1.2l-1.9 5.3z" fill="currentColor" opacity="0.72" />
		<path d="M11 12.4c-4.5 2.9-6 7.4-5.4 11 .7 4.2 4.8 5.9 10.4 5.9s9.7-1.7 10.4-5.9c.6-3.6-.9-8.1-5.4-11z" fill="currentColor" />
		<rect x="9.6" y="10.9" width="12.8" height="3.1" rx="1.55" fill="var(--brass)" />
		<circle cx="16" cy="21.6" r="4.3" fill="var(--brass)" />
		<rect x="14.55" y="20.15" width="2.9" height="2.9" rx="0.4" fill="currentColor" />
	</svg>
	<span class="tick">
		<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
			><path class="stroke" d="M20 6 9 17l-5-5" /></svg
		>
	</span>
	<span class="ring"></span>
</div>

<style>
	.moment {
		position: relative;
		width: 120px;
		height: 120px;
		display: grid;
		place-items: end center;
		color: var(--accent);
	}
	.pouch {
		display: block;
		transform-origin: 50% 90%;
		animation: settle 520ms 560ms var(--ease-out-back) both;
	}
	.coin {
		position: absolute;
		left: 50%;
		top: 0;
		width: 22px;
		height: 22px;
		margin-left: -11px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--brass) 55%, #fff), var(--brass) 55%, var(--brass-deep));
		box-shadow: 0 2px 4px rgb(0 0 0 / 0.18);
		display: grid;
		place-items: center;
		animation: drop 620ms 80ms cubic-bezier(0.55, 0, 0.85, 0.35) both;
	}
	.hole {
		width: 6px;
		height: 6px;
		border-radius: 1px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--brass-deep);
	}
	.tick {
		position: absolute;
		right: 6px;
		bottom: 4px;
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--success-fg);
		color: var(--bg);
		box-shadow:
			0 0 0 4px var(--bg),
			var(--shadow-md);
		animation: pop 420ms 900ms var(--ease-out-back) both;
	}
	.stroke {
		stroke-dasharray: 24;
		stroke-dashoffset: 24;
		animation: draw 320ms 1100ms var(--ease) forwards;
	}
	.ring {
		position: absolute;
		right: 6px;
		bottom: 4px;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 2px solid var(--success-fg);
		opacity: 0;
		animation: ring 900ms 1000ms var(--ease) forwards;
	}
	@keyframes drop {
		0% {
			transform: translateY(-36px) rotate(-30deg);
			opacity: 0;
		}
		25% {
			opacity: 1;
		}
		80% {
			opacity: 1;
		}
		100% {
			transform: translateY(46px) rotate(20deg) scale(0.8);
			opacity: 0;
		}
	}
	@keyframes settle {
		0% {
			transform: scale(1, 1);
		}
		35% {
			transform: scale(1.06, 0.9);
		}
		100% {
			transform: scale(1, 1);
		}
	}
	@keyframes pop {
		from {
			transform: scale(0);
		}
		to {
			transform: scale(1);
		}
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes ring {
		0% {
			transform: scale(1);
			opacity: 0.6;
		}
		100% {
			transform: scale(2.1);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.coin,
		.ring {
			display: none;
		}
		.pouch,
		.tick {
			animation: none;
		}
		.stroke {
			animation: none;
			stroke-dashoffset: 0;
		}
	}
</style>
