import React from 'react';
import "./Square.scss";
import { motion } from "framer-motion";

type SquareProps = {
    ind?: number | string;
    updateSquares?: (index: number | string) => void;
    clsName?: string;
    placeholder?: React.ReactNode;
    loading?: boolean;
};

const Square: React.FC<SquareProps> = ({ ind, updateSquares, clsName, placeholder, loading }) => {
    const handleClick = () => {
        if (loading) return;
        if (updateSquares && ind !== undefined) {
            updateSquares(ind);
        }
    };
    const showPlaceholder = !loading && !clsName && !!placeholder;
    const classes = [
        'square',
        showPlaceholder ? 'square-placeholder' : '',
        loading ? 'square-loading' : '',
    ].filter(Boolean).join(' ');
    return (
        <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={classes}
            onClick={handleClick}
        >
            {loading ? (
                <div className="square-spinner" aria-label="loading" />
            ) : clsName ? (
                <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className={`counter ${clsName}`}
                >
                    {clsName}
                </motion.span>
            ) : showPlaceholder ? (
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="placeholder"
                >
                    {placeholder}
                </motion.div>
            ) : null}
        </motion.div>
    );
};

export default Square;
