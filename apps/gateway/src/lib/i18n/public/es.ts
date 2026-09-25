import type { PublicMessages } from './mn';

export const es: PublicMessages = {
	'lang.label': 'Idioma',

	'pay.title': 'Pagar',
	'pay.banks': 'Elige la app de tu banco',
	'pay.orBanks': 'o elige la app de tu banco',
	'pay.scan': 'Escanea el código QR con la app de tu banco',
	'pay.showQr': 'Mostrar un código QR para escanear desde otro teléfono',
	'pay.qrAlt': 'Código QR de este pago',
	'pay.waiting': 'Esperando el pago',
	'pay.expiresIn': 'Paga en los próximos {time}',
	'pay.checkNow': 'Ya pagué: comprobar',
	'pay.checking': 'Comprobando…',
	'pay.notYet': 'Aún no se ha recibido',

	'state.paid.title': 'Pago realizado',
	'state.paid.at': 'Pagado el {time}',
	'state.returning': 'Te estamos llevando de vuelta…',
	'state.returnNow': 'Volver ahora',
	'state.back': 'Volver a {name}',
	'state.confirming': 'Confirmando tu pago…',
	'state.slow.title': 'Está tardando más de lo habitual',
	'state.slow.body': 'Puedes volver con tranquilidad. {name} recibirá un aviso cuando llegue el pago.',
	'state.expired.title': 'Este enlace de pago ha caducado',
	'state.expired.body': 'Vuelve a {name} para empezar de nuevo.',
	'state.failed.title': 'El pago no se completó',
	'state.failed.body': 'Vuelve a {name} para intentarlo de nuevo.',
	'state.cancelled.title': 'Este pago se canceló',
	'state.cancelled.body': 'Vuelve a {name} si aún quieres pagar.',

	'sandbox': 'Pago de prueba: no se mueve dinero real',
	'support.label': 'Ayuda',
	'support.site': 'Centro de ayuda',
	'footer.secured': 'Pago seguro',
	'footer.invoice': 'Factura {id}',
	'money.label': '{amount} tugriks',

	'error.notFound.title': 'Pago no encontrado',
	'error.notFound.body': 'Revisa el enlace, o vuelve y empieza de nuevo.',
	'error.generic.title': 'Algo salió mal',
	'error.generic.body': 'Espera un momento y vuelve a intentarlo.',
	'error.retry': 'Reintentar'
};
