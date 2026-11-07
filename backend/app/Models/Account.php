<?php

namespace App\Models;

use Database\Factories\AccountFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/** Use within an explicit ledger-qualified repository; never implicit route binding. */
class Account extends Model
{
    /** @use HasFactory<AccountFactory> */
    use HasFactory, HasUuids;

    protected $table = 'accounting.accounts';

    protected $primaryKey = 'row_id';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $guarded = ['row_id', 'ledger_id', 'id'];

    protected function casts(): array
    {
        return ['posting' => 'boolean', 'enabled' => 'boolean'];
    }
}
