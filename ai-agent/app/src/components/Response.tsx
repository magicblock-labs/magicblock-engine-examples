import React, { useEffect, useState } from 'react';

type ResponseProps = {
    loading: boolean;
    message: string | undefined;
    onClose: () => void;
};

const Response: React.FC<ResponseProps> = ({ loading, message, onClose }) => {
    //const [opacity, setOpacity] = useState(0);
    const [loadingDots, setLoadingDots] = useState('.');

    // Handle loading animation
    useEffect(() => {
        if (!message) {
            const loadingInterval = setInterval(() => {
                setLoadingDots(prev => prev.length >= 3 ? '.' : prev + '.');
            }, 500);
            return () => clearInterval(loadingInterval);
        }
    }, [message]);

    // Handle fade effect
    // useEffect(() => {
    //     setOpacity(1);
    //
    //     const fadeOutTimer = setTimeout(() => {
    //         setOpacity(0);
    //     }, 13000);
    //
    //     const removeTimer = setTimeout(() => {
    //         onClose();
    //     }, 14000);
    //
    //     return () => {
    //         clearTimeout(fadeOutTimer);
    //         clearTimeout(removeTimer);
    //     };
    // }, [onClose]);

    return (
        <div style={{
            padding: '0.2rem',
            marginBottom: '10px',
            borderRadius: '10px',
            color: 'white',
            transition: 'opacity 1s ease-in-out',
            opacity: 1,
            zIndex: 1000,
            justifyContent: 'center',
            alignItems: 'center',
            maxWidth: '100%',
            wordWrap: 'break-word',
            wordBreak: 'break-word',
            minHeight: '50px',
            boxSizing: 'border-box',
        }}>
            {message || (loading ? loadingDots : ' ')}
        </div>
    );
};

export default Response;