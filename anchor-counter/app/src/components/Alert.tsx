import React, { useEffect, useState } from 'react';

type AlertProps = {
    type: 'success' | 'error';
    message: string;
    onClose: () => void;
    href?: string;
};

const Alert: React.FC<AlertProps> = ({ type, message, onClose, href }) => {
    const [opacity, setOpacity] = useState(0); // Start with 0 opacity for fade-in effect

    useEffect(() => {
        setOpacity(1);

        // Linger longer when the notification is clickable so the user has time to click.
        const visibleMs = href ? 6000 : 3000;
        const fadeOutTimer = setTimeout(() => {
            setOpacity(0);
        }, visibleMs);

        const removeTimer = setTimeout(() => {
            onClose();
        }, visibleMs + 500);

        return () => {
            clearTimeout(fadeOutTimer);
            clearTimeout(removeTimer);
        };
    }, [onClose, href]);

    const color = type === 'success' ? 'green' : 'red';
    const containerStyle: React.CSSProperties = {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: type === 'success' ? 'lightgreen' : 'pink',
        padding: '20px',
        marginBottom: '10px',
        borderRadius: '10px',
        color,
        transition: 'opacity 1s ease-in-out',
        opacity: opacity,
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        maxWidth: '90%',
        wordWrap: 'break-word',
        wordBreak: 'break-word',
        minHeight: '50px',
        boxSizing: 'border-box',
        textDecoration: 'none',
        cursor: href ? 'pointer' : 'default',
    };

    if (href) {
        return (
            <a href={href} target="_blank" rel="noopener noreferrer" style={containerStyle}>
                {message} <span style={{ marginLeft: 4 }}>↗</span>
            </a>
        );
    }
    return <div style={containerStyle}>{message}</div>;
};

export default Alert;