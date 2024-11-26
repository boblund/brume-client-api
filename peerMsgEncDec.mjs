export { encodeMsg, decodeMsg, checkMsgType };

function encodeMsg({ type, data = {} }){
	const _data = type == 'chunk' ? data : new TextEncoder().encode( JSON.stringify( data ) );
	const a = new Uint8Array(1 + type.length + _data.length);
	a[ 0 ] = type.length;
	a.set( new TextEncoder().encode( type ), 1 );
	a.set( _data, 1 + a[ 0 ] );
	return a;
}

function decodeMsg( msg ){
	const type = String.fromCharCode( ...msg.slice( 1, 1 + msg[0] ) );
	const data = type == 'chunk'
		? msg.slice( 1 + msg[ 0 ] )
		: JSON.parse( String.fromCharCode( ...msg.slice( 1 + msg[0] ) ) );
	return { type, data };
}

function checkMsgType( msg, type ){
	return msg instanceof Uint8Array && msg[ 0 ] < msg.length
		&& String.fromCharCode( ...msg.slice( 1, 1 + msg[0] ) ) === type;
}
