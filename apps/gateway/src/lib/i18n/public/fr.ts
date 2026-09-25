import type { PublicMessages } from './mn';

export const fr: PublicMessages = {
	'lang.label': 'Langue',

	'pay.title': 'Payer',
	'pay.to': 'Bénéficiaire',
	'pay.banks': 'Choisissez votre application bancaire',
	'pay.orBanks': 'ou choisissez votre application bancaire',
	'pay.scan': 'Scannez le code QR avec votre application bancaire',
	'pay.showQr': 'Afficher un code QR à scanner depuis un autre téléphone',
	'pay.qrAlt': 'Code QR de ce paiement',
	'pay.waiting': 'En attente du paiement',
	'pay.expiresIn': 'Payez dans les {time}',
	'pay.checkNow': 'J’ai payé : vérifier',
	'pay.checking': 'Vérification…',
	'pay.notYet': 'Pas encore reçu',

	'state.paid.title': 'Paiement réussi',
	'state.paid.at': 'Payé le {time}',
	'state.returning': 'Retour en cours…',
	'state.returnNow': 'Revenir maintenant',
	'state.back': 'Retour à {name}',
	'state.confirming': 'Confirmation de votre paiement…',
	'state.slow.title': 'Cela prend plus de temps que d’habitude',
	'state.slow.body': 'Vous pouvez revenir sans risque. {name} sera prévenu dès l’arrivée du paiement.',
	'state.expired.title': 'Ce lien de paiement a expiré',
	'state.expired.body': 'Revenez sur {name} pour recommencer.',
	'state.failed.title': 'Le paiement n’a pas abouti',
	'state.failed.body': 'Revenez sur {name} pour réessayer.',
	'state.cancelled.title': 'Ce paiement a été annulé',
	'state.cancelled.body': 'Revenez sur {name} si vous souhaitez toujours payer.',

	'sandbox': 'Paiement de test : aucun argent réel',
	'support.label': 'Aide',
	'support.site': 'Site d’assistance',
	'footer.secured': 'Paiement sécurisé',
	'footer.invoice': 'Facture {id}',
	'money.label': '{amount} tugriks',

	'error.notFound.title': 'Paiement introuvable',
	'error.notFound.body': 'Vérifiez le lien, ou revenez en arrière et recommencez.',
	'error.generic.title': 'Une erreur est survenue',
	'error.generic.body': 'Patientez un instant et réessayez.',
	'error.retry': 'Réessayer'
};
