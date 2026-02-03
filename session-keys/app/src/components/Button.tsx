import React from 'react';

type ButtonProps = {
    title: string;
    resetGame: () => void;
    disabled?: boolean;
};

const Button: React.FC<ButtonProps> = ({ title, resetGame, disabled = false }) => {
    return (
        <button
            onClick={() => !disabled && resetGame()}
            disabled={disabled}
            style={{
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
                color: disabled ? '#666' : '#fff',
                transition: 'all 0.3s ease'
            }}
        >
            {title}
        </button>
    );
};

export default Button;