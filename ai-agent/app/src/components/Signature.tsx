import React, { useEffect, useState } from 'react';

type SignatureProps = {
    devnet: boolean;
    message: string | undefined;
    onClose: () => void;
};

const Signature: React.FC<SignatureProps> = ({ devnet, message, onClose }) => {
    const [opacity, setOpacity] = useState(0);

    // Handle fade effect
    useEffect(() => {
        setOpacity(1);

        const fadeOutTimer = setTimeout(() => {
            setOpacity(0);
        }, 7000);

        const removeTimer = setTimeout(() => {
            onClose();
        }, 7500);

        return () => {
            clearTimeout(fadeOutTimer);
            clearTimeout(removeTimer);
        };
    }, [onClose]);

    return (
        <div style={{
            fontSize: '1rem',
            padding: '20px',
            paddingLeft: '10%',
            paddingRight: '10%',
            marginBottom: '10px',
            borderRadius: '10px',
            color: 'green',
            opacity: opacity,
            transition: 'opacity 1s ease-in-out',
            zIndex: 1000,
            justifyContent: 'center',
            alignItems: 'center',
            maxWidth: '100%',
            wordWrap: 'break-word',
            wordBreak: 'break-word',
            minHeight: '50px',
            boxSizing: 'border-box',
        }}>
            <a rel="noreferrer" target="_blank" href={`https://explorer.solana.com/tx/${message}/${devnet ? '?cluster=devnet': ''}`} style={{ color: '#DC1FFF' }}>{message}</a>
        </div>
    );
};

export default Signature;