export { log };

const levels = [ 'DEBUG', 'INFO', 'WARN', 'ERROR' ];
let level = typeof window === 'undefined'
	? ( process.env?.LOG ? process.env.LOG : 'ERROR' )
	: ( localStorage?.LOG ? localStorage?.LOG : 'ERROR' );

const _log = a => ( ...b ) => {
	if( levels.indexOf( a ) > -1 && levels.indexOf( a ) >= levels.indexOf( level ) ) {
		console.log( `${ new Date().toLocaleString( 'sv-SE' ) } [ ${ a } ]`, ...b );
	}
};

const log = {
	debug( ...args ) { _log( 'DEBUG' )( ...args ); },
	info( ...args ) { _log( 'INFO' )( ...args ); },
	warn( ...args ) { _log( 'WARN' )( ...args ); },
	error( ...args ) { _log( 'ERROR' )( ...args ); },
	setLevel( l ){
		level = levels.indexOf( l ) > -1
			? levels.indexOf( l )
			: 1;
	}
};
