export { Brume };
import { encodeMsg, decodeMsg } from './peerMsgEncDec.mjs';
import { log } from './logger.mjs';

const jwt = { decode( t ){ return JSON.parse( atob( t.split( '.' )[1] ) ); } };
const	errorCodeMessages = {
	400: 'Bad signalling message',
	401: 'Unauthorized',
	402: 'Payment required',
	403: 'Invalid server url',
	404: 'This user is unknown',
	406: 'Bad token',
	409: 'This user is already connected',
	410: 'Payment required',
	500: 'Server error',
	501: 'Server error',
	EBADCONFIG: 'Invalid token',
	ECONNREFUSED: '',
	ENOSRV: 'No server connection',
	ENOTFOUND: '',
	ENODEST: 'not connected',
	NotAuthorizedException: 'Invalid refresh token'
};

class Brume { //extends EventEmitter {
	static log = log;
	static encodeMsg = encodeMsg;
	static decodeMsg = decodeMsg;
	#user = undefined;
	#ws = undefined;
	#config = undefined;
	#offerHandler = () => { Brume.log.error( 'No offerHandler' ) };
	#peers = {};

	constructor( { WebSocket, config, offerHandler } ){
		offerHandler && ( this.#offerHandler = offerHandler );
		if( typeof window === 'undefined' ){
			if( typeof WebSocket === 'undefined' ){
				throw( `Brume constructor requires ws in nodejs` );
			}
			global.WebSocket = WebSocket;
		}

		if( config ){
			this.#config = config;
			this.#user = jwt.decode( this.#config?.token )['custom:brume_name'];
		}
	}

	get thisUser() { return this.#user; }

	getPeer( name ){ return this.#peers?.[ name ]; }
	setPeer( name, peer = undefined ){ peer ? this.#peers[ name ] = peer : delete this.#peers[ name ]; }
	get activePeers(){ return Object.entries( this.#peers ).length !== 0; }

	start( config = undefined ){
		this.#config = config === undefined ? this.#config : config;
		try{
			this.#user = jwt.decode( this.#config?.token )['custom:brume_name'];
		} catch( e ){
			return Promise.reject( { code: 'EBADCONFIG', message: errorCodeMessages[ 'EBADCONFIG' ] } );
		}

		return new Promise( ( res, rej ) => {
			const { token, url } = this.#config;
			let ws;
			try{
				ws = typeof window == undefined
					? new WebSocket( url, { headers: { token }, rejectUnauthorized: false } )
					: new WebSocket( `${ url }?token=${ token }` );
			} catch( e ){
				Brume.log.error( `new WebSocket error: ${ JSON.stringify( e ) }` );
				rej( e );
			}

			this.#ws = ws;
			ws.onopen = () => { res( ws ); };
			ws.onerror = err => { rej( err ); };
			ws.addEventListener( 'message', ( msg ) => {
				let { from, ...data } = JSON.parse( msg.data );
				data = data?.data ? data.data  : data ;
				let peer = this.#peers?.[ from ];
				Brume.log.info( `ws message: ${ data.type }` );
				switch( data.type ){
					case 'offer':
						if( !this.#peers?.[ from ] ){
							this.#offerHandler( from, data );
							break;
						}
					case 'answer':
					case 'candidate':
					case 'renegotiate':
						peer.signal( data );
						break;

					case 'transceiverRequest':
						peer.addTransceiver( data.transceiverRequest.kind, { send: true, receive: true } );
						break;

					case 'peerError':
						this.#peers[ data.peerUsername ].emit( 'peerError', data );
						break;

					default:
						Brume.log.debug( `Brume unknown message: ${ JSON.stringify( data, null, 2 ) }` );
				}
			} );

			ws.addEventListener( 'close', ( event ) => {
				this.#ws = undefined;
			} );
		} );
	}

	stop(){
		this.#ws = undefined;
	}
}
