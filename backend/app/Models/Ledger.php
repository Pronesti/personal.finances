<?php

namespace App\Models;

use Database\Factories\LedgerFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Ledger extends Model
{
    /** @use HasFactory<LedgerFactory> */
    use HasFactory, HasUuids;

    protected $fillable = ['owner_user_id'];

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_user_id');
    }
}
